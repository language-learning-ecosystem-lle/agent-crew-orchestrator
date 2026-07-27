/**
 * The PROCESS test of `new-message` — the writing door, checked as a real command.
 *
 * What cannot be covered by the pure planner (`write.ts`) is the RESOLUTION of
 * provenance (R7): a raised session passes no flags at all, and everything it
 * records comes out of the environment the supervisor set for it. That resolution
 * lives in `cli.ts`, which is where this package's expensive defects have always
 * been — and where a silent change ("the variable was renamed") would leave the
 * feed quietly unattributed instead of loudly broken.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";
import { parseMessageFile } from "./message.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
    },
    {
      id: "john",
      kind: "human",
      status: "active",
      wake: { mode: "self" },
      summary: "the owner",
    },
    {
      id: "curator",
      kind: "claude.ai",
      status: "active",
      wake: { mode: "via-human", via: "john" },
      summary: "the keeper",
      permissions: ["launch-params", "thread-priority"],
    },
  ],
};

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";

/** A repository with a committed config and one file-based thread. */
const contour = (): { repo: string; root: string; body: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-newmsg-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const thread = join(repo, "agent-comms", "016-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "init"],
    { encoding: "utf8" },
  );
  const body = join(repo, "body.md");
  writeFileSync(body, "The answer.\n");
  return { repo, root: join(repo, "agent-comms"), body };
};

/** The command with everything but the provenance and the write mode filled in. */
const run = (
  contest: { repo: string; root: string; body: string },
  env: NodeJS.ProcessEnv,
  extra: readonly string[],
): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [
        CLI,
        "new-message",
        "--repo",
        contest.repo,
        "--root",
        contest.root,
        "--ref",
        "HEAD",
        "--no-fetch",
        "--thread",
        "016-x",
        "--from",
        "dev-core",
        "--expects",
        "answer",
        "--waiting-on",
        "curator",
        "--body-file",
        contest.body,
        ...extra,
      ],
      { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo), env) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/**
 * The write these cases are about — the FILE, with its front matter and its wait
 * marker. `--no-push` because since R3 `--write` alone means delivered: it would
 * commit and push, and this contour has no remote to push to. Delivery itself has
 * its own cases below, against a real bare remote.
 */
const write = (
  contest: { repo: string; root: string; body: string },
  env: NodeJS.ProcessEnv,
  ...extra: string[]
): { code: number; out: string } => run(contest, env, ["--write", "--no-push", ...extra]);

const written = (root: string): ReturnType<typeof parseMessageFile> => {
  const dir = join(root, "016-x", "messages");
  const names = readdirSync(dir).filter((name) => name.endsWith(".md"));
  return parseMessageFile(readFileSync(join(dir, names[0] as string), "utf8"));
};

describe("new-message and provenance", () => {
  it("a raised session records both without being asked: the launch environment carries them", () => {
    const contest = contour();
    const sessionFile = join(contest.repo, "run.session");
    writeFileSync(sessionFile, "8f3a2b1c-0d4e\n");

    const result = write(contest, {
      AGENT_PROTOCOL_WORKER: "claude-code",
      AGENT_PROTOCOL_SESSION_FILE: sessionFile,
    });

    expect(result.code).toBe(0);
    const message = written(contest.root);
    expect(message.fields.from).toBe("dev-core");
    expect(message.fields.worker).toBe("claude-code");
    expect(message.fields.session).toBe("8f3a2b1c-0d4e");
  });

  it("the flag beats the environment — a hand-written message says so even inside a session", () => {
    const contest = contour();

    const result = write(
      contest,
      { AGENT_PROTOCOL_WORKER: "claude-code" },
      "--worker",
      "human",
      "--session",
      "hand-1",
    );

    expect(result.code).toBe(0);
    expect(written(contest.root).fields.worker).toBe("human");
    expect(written(contest.root).fields.session).toBe("hand-1");
  });

  it("no environment, no flags → REFUSED, and nothing is written", () => {
    // The contract half of R7: the door requires what it can always obtain. Every
    // writer knows what it is — a raised session from its environment, everybody
    // else by saying so — and a message written without provenance can never be
    // repaired, because the feed is append-only.
    const contest = contour();

    const result = write(contest, {
      AGENT_PROTOCOL_WORKER: "",
      AGENT_PROTOCOL_SESSION_FILE: "",
    });

    expect(result.code).toBe(2);
    expect(result.out).toContain("--worker is required");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("refuses BEFORE --write too: a dry run that succeeds where the write refuses is a lie", () => {
    const contest = contour();

    const result = run(contest, { AGENT_PROTOCOL_WORKER: "", AGENT_PROTOCOL_SESSION_FILE: "" }, []);

    expect(result.code).toBe(2);
    expect(result.out).toContain("--worker is required");
  });

  it("a session without a worker is still refused — the id of a run does not name the tool", () => {
    const contest = contour();

    const result = write(
      contest,
      { AGENT_PROTOCOL_WORKER: "", AGENT_PROTOCOL_SESSION_FILE: "" },
      "--session",
      "hand-1",
    );

    expect(result.code).toBe(2);
    expect(result.out).toContain("--worker is required");
  });

  it("a session file that is not there is silence, not a failure", () => {
    const contest = contour();

    const result = write(contest, {
      AGENT_PROTOCOL_WORKER: "claude-code",
      AGENT_PROTOCOL_SESSION_FILE: join(contest.repo, "never-written.session"),
    });

    expect(result.code).toBe(0);
    const message = written(contest.root);
    expect(message.fields.worker).toBe("claude-code");
    expect(message.fields.session).toBeUndefined();
  });

  it("refuses a malformed worker at the door — a reader could not repair it afterwards", () => {
    const contest = contour();

    const result = write(contest, {}, "--worker", "Claude Code");

    expect(result.code).toBe(2);
    expect(result.out).toContain("--worker");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });
});

/**
 * DECLARING A WAIT FOR INPUT (R19) — the writing half of the interactive turn. It is
 * tested here rather than beside the supervisor because it is a property of the DOOR:
 * the declaration is written with the question, in one command, and every way of making
 * a wait that could never end is refused before anything is on disk.
 */
describe("new-message --await-input", () => {
  const waitPath = (repo: string): string => join(repo, "run.waiting");
  const sessionEnv = (repo: string): NodeJS.ProcessEnv => ({
    AGENT_PROTOCOL_WORKER: "claude-code",
    AGENT_PROTOCOL_SESSION_FILE: join(repo, "run.session"),
  });

  it("writes the declaration beside the question, naming the thread and the session", () => {
    const contest = contour();
    writeFileSync(join(contest.repo, "run.session"), "8f3a2b1c-0d4e\n");

    const result = write(contest, sessionEnv(contest.repo), "--await-input");

    expect(result.code).toBe(0);
    const marker = JSON.parse(readFileSync(waitPath(contest.repo), "utf8")) as Record<
      string,
      unknown
    >;
    expect(marker.thread).toBe("016-x");
    expect(marker.session).toBe("8f3a2b1c-0d4e");
    // The stamp of the declaration is the stamp of the question — one gesture, one moment.
    expect(marker.at).toBe(written(contest.root).fields.date);
    expect(result.out).toContain("parked, not finished");
  });

  it("a dry run declares NOTHING — the preview of a write touches no disk", () => {
    const contest = contour();

    const result = run(contest, sessionEnv(contest.repo), ["--await-input"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("would declare a wait");
    expect(existsSync(waitPath(contest.repo))).toBe(false);
  });

  it("REFUSES when the message keeps the turn — nobody would be told to answer", () => {
    // The notifier fires on the turn passing; a question that does not pass it would sit
    // unread until the ceiling. Checked for both shapes of "not passing": no declaration
    // at all, and a declaration that names the asker.
    const contest = contour();
    const withWaitingOn = (value: string | undefined): { code: number; out: string } => {
      const argv = [
        CLI,
        "new-message",
        "--repo",
        contest.repo,
        "--root",
        contest.root,
        "--ref",
        "HEAD",
        "--no-fetch",
        "--thread",
        "016-x",
        "--from",
        "dev-core",
        "--expects",
        "answer",
        "--body-file",
        contest.body,
        "--await-input",
        "--write",
        "--no-push",
        ...(value === undefined ? [] : ["--waiting-on", value]),
      ];
      try {
        return {
          code: 0,
          out: execFileSync(TSX, argv, {
            encoding: "utf8",
            stdio: "pipe",
            env: sandbox(configHomeInside(contest.repo), sessionEnv(contest.repo)),
          }),
        };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
      }
    };

    for (const value of [undefined, "dev-core"]) {
      const result = withWaitingOn(value);
      expect(result.code, `waiting-on: ${value}`).toBe(2);
      expect(result.out).toContain("--await-input needs the message to pass the turn");
    }
    expect(existsSync(waitPath(contest.repo))).toBe(false);
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("REFUSES outside a raised run — a session nobody watches cannot be parked", () => {
    // There is no supervisor to honour the declaration and no ceiling on the wait; a
    // human at a terminal simply waits by hand.
    const contest = contour();

    const result = write(
      contest,
      { AGENT_PROTOCOL_WORKER: "human", AGENT_PROTOCOL_SESSION_FILE: "" },
      "--await-input",
    );

    expect(result.code).toBe(2);
    expect(result.out).toContain("raised by the orchestrator");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("REFUSES a session-file path of the wrong shape instead of writing beside it", () => {
    // A blind `.session` → `.waiting` swap on an unexpected name would return the name
    // unchanged — that is, overwrite the file the path came from.
    const contest = contour();

    const result = write(
      contest,
      { AGENT_PROTOCOL_WORKER: "claude-code", AGENT_PROTOCOL_SESSION_FILE: "/tmp/run.log" },
      "--await-input",
    );

    expect(result.code).toBe(2);
    expect(result.out).toContain("not a session-id path");
  });

  it("without the flag nothing is declared — the ordinary reply is unchanged", () => {
    const contest = contour();

    expect(write(contest, sessionEnv(contest.repo)).code).toBe(0);
    expect(existsSync(waitPath(contest.repo))).toBe(false);
  });
});

/**
 * DELIVERY (R3) — `--write` means SENT, and the only way to know it is a real remote.
 *
 * The contour is the smallest thing that can tell the truth here: a bare repository
 * as `origin`, a clone as the mail checkout, and the branch the config names. What is
 * checked is what the agent no longer has to do by hand — the commit exists, the
 * remote has it, and a feed that moved underneath the writer is retried rather than
 * reported as a failure.
 */
const delivery = (): { repo: string; root: string; body: string; remote: string } => {
  const remote = mkdtempSync(join(tmpdir(), "agent-protocol-remote-"));
  execFileSync("git", ["-C", remote, "init", "-q", "--bare", "-b", "comms"]);

  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-deliver-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "comms"]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const thread = join(repo, "agent-comms", "016-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
      encoding: "utf8",
    });
  git("add", ".");
  git("commit", "-qm", "init");
  git("push", "-q", "origin", "comms");

  // The body lies OUTSIDE the checkout, because that is the only place a caller may
  // put it: delivery refuses a dirty checkout, and an untracked draft in the mail
  // checkout is dirt like any other. Writing it beside the mail was this test's own
  // first mistake, and it failed exactly the way a real caller's would.
  const body = join(mkdtempSync(join(tmpdir(), "agent-protocol-body-")), "body.md");
  writeFileSync(body, "The answer.\n");
  return { repo, root: join(repo, "agent-comms"), body, remote };
};

/**
 * The identity goes in the ENVIRONMENT, not in flags: the commit is made by the CLI,
 * several git calls deep, and a test cannot reach it with `-c user.email=…`. A real
 * mail checkout has an identity of its own; a temporary one has none, and on the
 * runner there is no global config to fall back on either — which is exactly why this
 * suite passed on a developer's machine and failed in CI.
 */
const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@e",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@e",
};

const send = (
  contest: { repo: string; root: string; body: string },
  ...extra: string[]
): { code: number; out: string } =>
  run(
    contest,
    { AGENT_PROTOCOL_WORKER: "claude-code", AGENT_PROTOCOL_SESSION_FILE: "", ...IDENTITY },
    ["--write", ...extra],
  );

describe("new-message --write delivers (R3)", () => {
  it("one action: the file, the commit and the push — nothing is left for the agent to type", () => {
    const contest = delivery();

    const result = send(contest);

    expect(result.code).toBe(0);
    expect(result.out).toContain("committed and pushed");
    // The message is in the REMOTE, not merely on our disk: an unpushed message
    // exists for nobody.
    const remoteFiles = execFileSync(
      "git",
      ["-C", contest.remote, "ls-tree", "-r", "--name-only", "comms"],
      { encoding: "utf8" },
    );
    expect(remoteFiles).toMatch(/agent-comms\/016-x\/messages\/.*-dev-core\.md/);
    // And the checkout is clean afterwards — a delivered message is not a diff
    // somebody has to notice.
    expect(
      execFileSync("git", ["-C", contest.repo, "status", "--porcelain"], { encoding: "utf8" }),
    ).toBe("");
  });

  it("stages only the message: the derived files stay the generator's business", () => {
    const contest = delivery();
    send(contest);

    const changed = execFileSync(
      "git",
      ["-C", contest.repo, "show", "--name-only", "--format=", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    expect(changed).toContain("messages/");
    expect(changed).not.toContain("_thread.md");
    expect(changed).not.toContain("INDEX.md");
  });

  it("a feed that moved underneath the writer is retried, not reported as a failure", () => {
    const contest = delivery();
    // Somebody else's message lands in the remote first — the push of our first
    // attempt is rejected, and the retry replans on top of theirs.
    const other = mkdtempSync(join(tmpdir(), "agent-protocol-other-"));
    execFileSync("git", ["-C", other, "clone", "-q", "-b", "comms", contest.remote, "."]);
    // git does not carry empty directories, so the clone has no `messages/` yet.
    mkdirSync(join(other, "agent-comms", "016-x", "messages"), { recursive: true });
    const theirs = join(
      other,
      "agent-comms",
      "016-x",
      "messages",
      "2026-07-26T09-00-00Z-curator.md",
    );
    writeFileSync(
      theirs,
      "---\nfrom: curator\ndate: 2026-07-26T09:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nTheirs.\n",
    );
    execFileSync("git", ["-C", other, "-c", "user.name=t", "-c", "user.email=t@e", "add", "."]);
    execFileSync("git", [
      "-C",
      other,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@e",
      "commit",
      "-qm",
      "theirs",
    ]);
    execFileSync("git", ["-C", other, "push", "-q", "origin", "comms"]);

    const result = send(contest);

    expect(result.code).toBe(0);
    // Both messages are in the feed: append-only means the loser of the race is
    // replanned, never overwritten.
    const remoteFiles = execFileSync(
      "git",
      ["-C", contest.remote, "ls-tree", "-r", "--name-only", "comms"],
      { encoding: "utf8" },
    );
    expect(remoteFiles).toContain("2026-07-26T09-00-00Z-curator.md");
    expect(remoteFiles).toMatch(/-dev-core\.md/);
  });

  it("a git that refuses says WHY: the failure carries git's own words, not a bare exit code", () => {
    // The case from the runner, made deterministic: no identity anywhere (the global
    // and system configs are taken away as well, or a developer's own would answer for
    // the checkout). Before this the command died on an unhandled throw — code 1, a
    // stack trace, and a CI log that named neither git nor identity.
    const contest = delivery();

    const result = run(
      contest,
      {
        AGENT_PROTOCOL_WORKER: "claude-code",
        AGENT_PROTOCOL_SESSION_FILE: "",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_AUTHOR_NAME: "",
        GIT_AUTHOR_EMAIL: "",
        GIT_COMMITTER_NAME: "",
        GIT_COMMITTER_EMAIL: "",
      },
      ["--write"],
    );

    expect(result.code).toBe(2);
    expect(result.out).toContain("git commit");
    expect(result.out.toLowerCase()).toContain("ident");
  });

  it("a dirty checkout is a refusal: delivery resets on a rejected push and will not do that over somebody's draft", () => {
    const contest = delivery();
    writeFileSync(join(contest.root, "016-x", "draft.md"), "half a thought\n");

    const result = send(contest);

    expect(result.code).toBe(2);
    expect(result.out).toContain("uncommitted changes");
  });
});

/**
 * THE DOOR OF A LAUNCH DIRECTIVE (R21). Both refusals here are about the same fact:
 * the feed is append-only, so everything knowable while the author still holds the
 * flag has to be refused now — afterwards nothing may be fatal, and the resolution
 * can only drop the directive with a line.
 */
const direct = (
  contest: { repo: string; root: string; body: string },
  from: string,
  ...extra: string[]
): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [
        CLI,
        "new-message",
        "--repo",
        contest.repo,
        "--root",
        contest.root,
        "--ref",
        "HEAD",
        "--no-fetch",
        "--thread",
        "016-x",
        "--from",
        from,
        "--expects",
        "answer",
        "--waiting-on",
        "dev-core",
        "--body-file",
        contest.body,
        "--worker",
        "human",
        "--write",
        "--no-push",
        ...extra,
      ],
      { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo)) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

describe("new-message and the launch directive (R21)", () => {
  it("an authorized role writes it into the header, where the reader finds it", () => {
    const contest = contour();

    const result = direct(contest, "curator", "--model", "opus", "--effort", "high");

    expect(result.code).toBe(0);
    expect(written(contest.root).fields.launch).toEqual({ model: "opus", effort: "high" });
  });

  it("a role without 'launch-params' is refused at the door, not left with a void directive in the feed", () => {
    const contest = contour();

    const result = direct(contest, "dev-core", "--model", "opus");

    expect(result.code).toBe(2);
    expect(result.out).toContain("launch-params");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("an effort outside the tool vocabulary is refused while the flag can still be retyped", () => {
    const contest = contour();

    const result = direct(contest, "curator", "--effort", "ultra");

    expect(result.code).toBe(2);
    expect(result.out).toContain("allowed levels");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });
});

describe("new-message and the priority of a thread (R5)", () => {
  it("an authorized role writes it into the header, where the queue finds it", () => {
    const contest = contour();

    const result = direct(contest, "curator", "--priority", "high");

    expect(result.code).toBe(0);
    expect(written(contest.root).fields.priority).toBe("high");
  });

  it("a role without 'thread-priority' is refused at the door, not left with a void priority in the feed", () => {
    // The feed is append-only: a statement nobody will honour cannot be taken back
    // either, so it must not be writable in the first place.
    const contest = contour();

    const result = direct(contest, "dev-core", "--priority", "high");

    expect(result.code).toBe(2);
    expect(result.out).toContain("thread-priority");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("a value outside the vocabulary is refused while the flag can still be retyped", () => {
    const contest = contour();

    const result = direct(contest, "curator", "--priority", "urgent");

    expect(result.code).toBe(2);
    expect(result.out).toContain("high, normal, low");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });
});
