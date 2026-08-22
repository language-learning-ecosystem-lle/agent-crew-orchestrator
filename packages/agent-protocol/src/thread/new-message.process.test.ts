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
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
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

  /**
   * THE WINDOW BETWEEN THE SPAWN AND THE ID (thread 021), pinned as a FACT rather than
   * left in a comment. The supervisor writes the id file only once it has parsed the id
   * off the session's own stream; a message written before that — or after the file was
   * emptied, or where it cannot be read at all — goes out with `worker` and no `session`,
   * and it GOES OUT: a run that could not name its run still has a turn to pass.
   *
   * Each of the three shapes is a case of its own because they fail in different places
   * inside `provenanceFrom` (no file, an empty read, a read that throws), and a comment
   * does not break when one of them starts refusing.
   */
  for (const [shape, prepare] of [
    ["the file does not exist yet", (path: string): void => rmSync(path, { force: true })],
    ["the file is there but empty", (path: string): void => writeFileSync(path, "")],
    ["the file cannot be read at all", (path: string): void => mkdirSync(path)],
  ] as const) {
    it(`the message is WRITTEN, with a worker and no session, when ${shape}`, () => {
      const contest = contour();
      const sessionFile = join(contest.repo, "run.session");
      prepare(sessionFile);

      const result = write(contest, {
        AGENT_PROTOCOL_WORKER: "claude-code",
        AGENT_PROTOCOL_SESSION_FILE: sessionFile,
      });

      expect(result.code).toBe(0);
      const message = written(contest.root);
      expect(message.fields.worker).toBe("claude-code");
      expect(message.fields.session).toBeUndefined();
    });
  }

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
    //
    // THE PATH LIVES INSIDE THIS CASE'S OWN TEMPORARY REPOSITORY, and that is the whole
    // point of it: a literal '/tmp/run.log' is shared state on a box, and the door
    // READS the file before it judges the shape (`provenanceFrom`). On 2026-08-14 a
    // session on this machine had dumped a CI log to exactly that name, the shared
    // self-hosted runner saw it, and the refusal that came back was about the session id
    // read out of it — 'checks' went red on two heads of #264 for a file no test wrote.
    const contest = contour();

    const result = write(
      contest,
      {
        AGENT_PROTOCOL_WORKER: "claude-code",
        AGENT_PROTOCOL_SESSION_FILE: join(contest.repo, "run.log"),
      },
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

/** The same delivery from ANOTHER role — the second half of what a shared checkout is. */
const sendFrom = (
  contest: { repo: string; root: string; body: string },
  from: string,
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
      ],
      { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo), IDENTITY) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/** Who the last commit of the mail checkout is by — author and, where asked, committer. */
const head = (repo: string, format = "%an <%ae>"): string =>
  execFileSync("git", ["-C", repo, "log", "-1", `--format=${format}`], {
    encoding: "utf8",
  }).trim();

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
    // Before this the command died on an unhandled throw — code 1, a stack trace, and
    // a CI log that named neither git nor the reason. The refusal is provoked at the
    // fetch, which is the first git call that can fail on somebody else's setup.
    const contest = delivery();
    execFileSync("git", ["-C", contest.repo, "remote", "set-url", "origin", "/nowhere/at/all"]);

    const result = send(contest);

    expect(result.code).toBe(2);
    expect(result.out).toContain("git fetch");
    expect(result.out).toContain("/nowhere/at/all");
  });

  /**
   * 027: the commit is signed BY THE ROLE, out of `--from`, through the environment of
   * that one git call. The three cases below are the acceptance of the mail half —
   * they are here rather than in the unit tests because the question is what the
   * COMMIT OBJECT ends up saying, and only a real git writes one.
   */
  it("the commit is authored by the role, not by the owner of the machine", () => {
    const contest = delivery();

    // The environment says the machine owner ('t') — as a real one does, and as `send`
    // has always done. The role has to outrank it.
    send(contest);

    expect(head(contest.repo)).toBe("dev-core <dev-core@agents.invalid>");
  });

  it("two roles writing into ONE checkout leave two different authors", () => {
    const contest = delivery();

    send(contest);
    sendFrom(contest, "curator");

    const authors = execFileSync("git", ["-C", contest.repo, "log", "-2", "--format=%an <%ae>"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    // Newest first: curator's, then dev-core's. This is the pair a configured checkout
    // could never produce — whoever set `user.name` last would sign both.
    expect(authors).toEqual([
      "curator <curator@agents.invalid>",
      "dev-core <dev-core@agents.invalid>",
    ]);
  });

  it("a checkout with no identity of its own delivers anyway — the role carries one", () => {
    // The case from the runner: no `user.email` in the checkout and no global config to
    // fall back on. It used to be a refusal at `git commit`; with the signature travelling
    // with the message there is nothing left to configure.
    const contest = delivery();

    const result = run(
      contest,
      {
        AGENT_PROTOCOL_WORKER: "claude-code",
        AGENT_PROTOCOL_SESSION_FILE: "",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
      ["--write"],
    );

    expect(result.code).toBe(0);
    expect(head(contest.repo)).toBe("dev-core <dev-core@agents.invalid>");
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
/**
 * A `gh` ON `PATH` that answers the ONE call the door of a `run:` park makes (thread 062).
 *
 * A shim rather than an injected source: the door is the thing under test, and it resolves the
 * binary itself — a stub handed to it would test everything except the wiring that failed live.
 */
const ghShim = (
  repo: string,
  answer:
    | { readonly headSha: string; readonly mergeable: string; readonly runs: number }
    | { readonly refuse: true },
): string => {
  const dir = join(repo, `gh-shim-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  const body =
    "refuse" in answer
      ? 'echo "gh: no token" >&2; exit 1'
      : `cat <<'JSON'\n${JSON.stringify({
          headRefOid: answer.headSha,
          mergeable: answer.mergeable,
          statusCheckRollup: Array.from({ length: answer.runs }, (_, at) => ({
            name: `check-${at}`,
            status: "IN_PROGRESS",
          })),
        })}\nJSON`;
  const bin = join(dir, "gh");
  writeFileSync(bin, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return dir;
};

const direct = (
  contest: { repo: string; root: string; body: string },
  from: string,
  ...extra: (string | NodeJS.ProcessEnv)[]
): { code: number; out: string } => {
  const env = extra.find((entry) => typeof entry !== "string") ?? {};
  const args = extra.filter((entry): entry is string => typeof entry === "string");
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
        ...args,
      ],
      { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo), env) },
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

describe("new-message and the turn parked behind a person (R27)", () => {
  it("writes the person into the header while the turn stays where it is", () => {
    const contest = contour();

    const result = direct(contest, "curator", "--parked-on", "john");

    expect(result.code).toBe(0);
    expect(written(contest.root).fields.parkedOn).toBe("john");
  });

  it("a role the circuit CAN wake is refused — that is a turn to pass, not a person to wait for", () => {
    const contest = contour();

    const result = direct(contest, "curator", "--parked-on", "dev-core");

    expect(result.code).toBe(2);
    expect(result.out).toContain("--waiting-on dev-core");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("a name that is in no config is refused while the flag can still be retyped", () => {
    const contest = contour();

    const result = direct(contest, "curator", "--parked-on", "jonh");

    expect(result.code).toBe(2);
    expect(result.out).toContain("not listed in the config");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("THE DELIVERY OF A WORD is written into the header — the one lift of that park (030)", () => {
    const contest = contour();

    const result = direct(contest, "curator", "--delivers", "john");

    expect(result.code).toBe(0);
    expect(written(contest.root).fields.delivers).toBe("john");
  });

  it("--delivers with a role the circuit CAN wake is refused BY NAME, with the exit named", () => {
    // No turn is ever parked behind such a role — it speaks for itself in the feed — so the
    // delivery of its word could lift nothing at all. The refusal says what to type instead.
    const contest = contour();

    const result = direct(contest, "curator", "--delivers", "dev-core");

    expect(result.code).toBe(2);
    expect(result.out).toContain("--delivers 'dev-core'");
    expect(result.out).toContain("--waiting-on dev-core");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("--delivers with a name no config knows is refused while the flag can still be retyped", () => {
    const contest = contour();

    const result = direct(contest, "curator", "--delivers", "jonh");

    expect(result.code).toBe(2);
    expect(result.out).toContain("not listed in the config");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("an EVENT is a legal park too: 'pr:127' names a merge, and no config knows it", () => {
    // Thread 023, variant A: the two parks are one state and differ in what lifts them, so
    // they share the field. The door checks the shape and stops — asking GitHub whether the
    // number exists is not the door's business, and the park lifts on the notifier's word.
    const contest = contour();

    const result = direct(contest, "dev-core", "--parked-on", "pr:127");

    expect(result.code).toBe(0);
    expect(written(contest.root).fields.parkedOn).toBe("pr:127");
    // AND THE DOOR SAYS THE CONDITION OF THE LIFT OUT LOUD (thread 030, Д-3). The note is
    // asserted HERE and not only on `describePrPark` because the defect it repairs lives in
    // the door: the park was declared through this command, and what the writer never read
    // was what this command printed back. A pure function returning the right sentence to
    // nobody is the same silence with a green test on it — the `run:` note is checked at this
    // level for the same reason, a few cases below.
    expect(result.out).toContain("lifts on ONE thing");
    expect(result.out).toContain("'merged-pr: 127'");
    expect(result.out).toContain("NOTHING WATCHES THE STATE OF #127");
  });

  it("the refusal of an unknown name names the event form — it is the other legal value", () => {
    const contest = contour();

    const result = direct(contest, "curator", "--parked-on", "pr-127");

    expect(result.code).toBe(2);
    expect(result.out).toContain("pr:<number>");
    // The writing door and the reader learn a value TOGETHER (requirement of 023): a form the
    // writer can put in the feed and the reader goes blind on is the mine this line watches.
    expect(result.out).toContain("run:<number>");
  });

  it("the ROUND of a PR passes the same door: 'run:163' waits for a verdict (thread 019)", () => {
    const contest = contour();

    const result = direct(contest, "dev-core", "--parked-on", "run:163", {
      PATH: `${ghShim(contest.repo, { headSha: "6f933b0321ab", mergeable: "MERGEABLE", runs: 3 })}:${process.env.PATH ?? ""}`,
    });

    expect(result.code).toBe(0);
    expect(written(contest.root).fields.parkedOn).toBe("run:163");
  });

  // THREAD 062, LAYER 1 — the live case of 2026-08-08 replayed through the real door: PR #243
  // was CONFLICTING, so no run was ever born on its head and the pair stood 2h10m waiting for
  // a message nobody would write.
  it("a park on a round with NO RUN on the head is refused, and nothing is written", () => {
    const contest = contour();

    const result = direct(contest, "dev-core", "--parked-on", "run:243", {
      PATH: `${ghShim(contest.repo, { headSha: "6f933b0321ab", mergeable: "MERGEABLE", runs: 0 })}:${process.env.PATH ?? ""}`,
    });

    expect(result.code).toBe(2);
    expect(result.out).toContain("not one run on head 6f933b03");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("a CONFLICTING pull request is refused by its own reason — no merge ref, no run", () => {
    const contest = contour();

    const result = direct(contest, "dev-core", "--parked-on", "run:243", {
      PATH: `${ghShim(contest.repo, { headSha: "6f933b0321ab", mergeable: "CONFLICTING", runs: 0 })}:${process.env.PATH ?? ""}`,
    });

    expect(result.code).toBe(2);
    expect(result.out).toContain("CONFLICTING");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  // The degradation, end to end: a `gh` that refuses does NOT cost the role its message.
  it("a gh that cannot answer leaves the park standing, with the reason printed", () => {
    const contest = contour();

    const result = direct(contest, "dev-core", "--parked-on", "run:243", {
      PATH: `${ghShim(contest.repo, { refuse: true })}:${process.env.PATH ?? ""}`,
    });

    expect(result.code).toBe(0);
    expect(result.out).toContain("NOT verified");
    expect(written(contest.root).fields.parkedOn).toBe("run:243");
  });

  it("'run' without a number is a name, and is refused as one", () => {
    const contest = contour();

    const result = direct(contest, "curator", "--parked-on", "run:");

    expect(result.code).toBe(2);
    expect(result.out).toContain("not listed in the config");
  });

  it("--merged-pr is the fact that lifts an event park, and only a number is one", () => {
    const contest = contour();

    expect(direct(contest, "curator", "--merged-pr", "127").code).toBe(0);
    expect(written(contest.root).fields.mergedPr).toBe(127);
    expect(direct(contour(), "curator", "--merged-pr", "#127").code).toBe(2);
  });

  it("A PARK ON AN INFORMATIONAL MESSAGE PASSES — the park as a MODE, calling nobody", () => {
    // Refused from 034 until 2026-08-04 (decision of john, thread 023): the refusal rested on
    // such a park being one that informational traffic may lift and one that rings at a human
    // with nothing asked. Both reasons are gone — the lift of a person park became narrow the
    // same day, and #186 made the courier ring on FRESH parks that ASK. The live parks of 016
    // and 052 are exactly this shape: a line of state, no call.
    const contest = contour();

    const result = parkedWithExpects(contest, "none");

    expect(result.code).toBe(0);
    expect(written(contest.root).fields.parkedOn).toBe("john");
    expect(written(contest.root).fields.expects).toBe("none");
  });

  it("the other refusals of the door are untouched by that — only this one combination moved", () => {
    // The guard of 023.5 is narrow by construction: an unknown name, a role the circuit wakes
    // and the event forms are judged exactly as before, with `--expects none` alongside.
    expect(parkedWithExpects(contour(), "answer").code).toBe(0);
    const unknown = contour();
    expect(direct(unknown, "curator", "--parked-on", "jonh").code).toBe(2);
    const wakeable = contour();
    expect(direct(wakeable, "curator", "--parked-on", "dev-core").code).toBe(2);
  });
});

/**
 * The command with `--expects` and the park as the variables, and the turn named as the
 * author's OWN — the door of thread 022, where a role waiting for a human wrote a header
 * that says "I am carrying on by myself" and the circuit raised it until `exhausted`.
 */
const selfTurned = (
  contest: { repo: string; root: string; body: string },
  expects: string,
  extra: readonly string[] = [],
  /** Whom the header names as acting next — the author itself unless a test says otherwise. */
  waiting = "curator",
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
        "curator",
        "--expects",
        expects,
        "--waiting-on",
        waiting,
        ...extra,
        "--body-file",
        contest.body,
        "--worker",
        "human",
        "--write",
        "--no-push",
      ],
      { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo)) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

describe("new-message and a park by MEANING that is not a park by FIELD (thread 022)", () => {
  it("REFUSES 'expects: ack' + a self-named turn without a park, and nothing is written", () => {
    // The live header of `010-speech-service`, 2026-08-21: six of them, then the pair went
    // `exhausted`. The refusal bites into the TEXT — a refusal that does not name the exit is
    // one the raised session cannot repair.
    const contest = contour();

    const result = selfTurned(contest, "ack");

    expect(result.code).toBe(2);
    expect(result.out).toContain("--parked-on <person>");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("WARNS on 'expects: answer' + a self-named turn, and writes the message all the same", () => {
    // The measured class is 173 messages of live everyday form, against 17 of the `ack` one:
    // the warning is read by the raised session it is addressed to, and blocks nobody.
    const contest = contour();

    const result = selfTurned(contest, "answer");

    expect(result.code).toBe(0);
    expect(result.out).toContain("--parked-on <person>");
    expect(written(contest.root).fields.waitingOn).toBe("curator");
  });

  it("'expects: none' + a self-named turn passes IN SILENCE — the middle of a working thread", () => {
    const contest = contour();

    const result = selfTurned(contest, "none");

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("--parked-on <person>");
    expect(written(contest.root).fields.expects).toBe("none");
  });

  it("the same header WITH a park passes in silence — the net of 020 does not move", () => {
    const contest = contour();

    const result = selfTurned(contest, "ack", ["--parked-on", "john"]);

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("--parked-on <person>");
    expect(written(contest.root).fields.parkedOn).toBe("john");
  });

  it("a turn handed to ANOTHER role passes in silence at any --expects", () => {
    // The door does not touch the handover of a turn: there the circuit knows who acts next.
    const acked = contour();
    const result = selfTurned(acked, "ack", [], "dev-core");

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("--parked-on <person>");
    expect(written(acked.root).fields.waitingOn).toBe("dev-core");
  });

  it("the TWIN door refuses it too — an opening message is a message (the lesson of 075)", () => {
    // A door standing on one command of the pair is the defect of 075 verbatim: there the park
    // itself parsed for `new-message` alone and was swallowed here without a word.
    const contest = contour();

    const result = newThread(contest, "018-y", "dev-core", "ack");

    expect(result.code).toBe(2);
    expect(result.out).toContain("--parked-on <person>");
    expect(existsSync(join(contest.root, "018-y"))).toBe(false);
  });
});

/** `--parked-on` with an `--expects` of the caller's choosing — the door under test here. */
const parkedWithExpects = (
  contest: { repo: string; root: string; body: string },
  expects: string,
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
        "curator",
        "--expects",
        expects,
        "--waiting-on",
        "dev-core",
        "--parked-on",
        "john",
        "--body-file",
        contest.body,
        "--worker",
        "human",
        "--write",
        // `--no-push`: the door is what is under test, and this contour has no remote —
        // the body file lives inside the checkout, which delivery refuses to touch.
        "--no-push",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { code: failure.status, out: `${failure.stdout}${failure.stderr}` };
  }
};

/** The command with `--waiting-on` as the only variable — the door under test here. */
const waitingOn = (
  contest: { repo: string; root: string; body: string },
  value: string,
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
        value,
        "--body-file",
        contest.body,
        "--worker",
        "human",
        "--write",
        "--no-push",
      ],
      { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo)) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

describe("new-message and the scalar turn (R24)", () => {
  it("REFUSES two roles at the door instead of keeping one of them", () => {
    // Keeping one would reproduce pain 2 — somebody's unclosed turn evaporating —
    // inside the very tool that was written to end it, and silently. The feed is
    // append-only, so a wrong declaration cannot be taken back: it must not be
    // writable.
    const contest = contour();

    const result = waitingOn(contest, "curator, john");

    expect(result.code).toBe(2);
    expect(result.out).toContain("--waiting-on takes ONE role");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("REFUSES a wait on a role nobody wakes, and says what to write instead", () => {
    const contest = contour();

    const result = waitingOn(contest, "john");

    expect(result.code).toBe(2);
    expect(result.out).toContain("wakes itself");
    expect(result.out).toContain("whoever carries the question");
    expect(readdirSync(join(contest.root, "016-x", "messages"))).toEqual([]);
  });

  it("writes ONE role as the scalar it now is, and '—' as the turn lifted", () => {
    const contest = contour();

    expect(waitingOn(contest, "curator").code).toBe(0);
    expect(written(contest.root).fields.waitingOn).toBe("curator");

    const lifted = contour();
    expect(waitingOn(lifted, "—").code).toBe(0);
    expect(written(lifted.root).fields.waitingOn).toBeNull();
  });
});

/** `new-thread` with everything but the id filled in; `null` leaves out `--waiting-on`. */
const newThread = (
  contest: { repo: string; root: string; body: string },
  id: string,
  waitingOn: string | null = "curator",
  expects = "answer",
): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [
        CLI,
        "new-thread",
        "--repo",
        contest.repo,
        "--root",
        contest.root,
        "--ref",
        "HEAD",
        "--no-fetch",
        "--id",
        id,
        "--title",
        "T",
        "--participants",
        "dev-core, curator",
        "--from",
        "dev-core",
        "--expects",
        expects,
        ...(waitingOn === null ? [] : ["--waiting-on", waitingOn]),
        "--worker",
        "claude-code",
        "--body-file",
        contest.body,
        "--write",
        // Since thread 033 `--write` DELIVERS here too, and the contour has no remote:
        // without this flag a green door would fail on the push and the number test
        // would be measuring the transport instead of the number.
        "--no-push",
      ],
      { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo)) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

describe("new-thread and the uniqueness of a number (thread 029)", () => {
  it("REFUSES a number already taken, and names who holds it", () => {
    // The contour already carries `016-x`. Before this door, `016-y` was created
    // without a word and "тред 016" stopped being an address.
    const contest = contour();

    const result = newThread(contest, "016-y");

    expect(result.code).toBe(2);
    expect(result.out).toContain("016-x");
    expect(existsSync(join(contest.root, "016-y"))).toBe(false);
  });

  it("a free number is created as before", () => {
    const contest = contour();

    expect(newThread(contest, "017-y").code).toBe(0);
    expect(existsSync(join(contest.root, "017-y", "_meta.md"))).toBe(true);
  });
});

/**
 * The command with the body and `--waiting-on` as the variables — the door of thread
 * 042, where a message SAID the header let the turn go and the header said nothing.
 */
const claiming = (
  contest: { repo: string; root: string; body: string },
  body: string,
  extra: readonly string[],
): { code: number; out: string } => {
  const file = join(contest.repo, "claim.md");
  writeFileSync(file, body);
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
        "none",
        "--body-file",
        file,
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

const filesIn = (contest: { root: string }): readonly string[] =>
  readdirSync(join(contest.root, "016-x", "messages"));

describe("a turn released in the prose only (thread 042)", () => {
  it("REFUSES the message whose body says 'waiting-on: —' while no flag was given", () => {
    // The live case: curator's and dev-core's messages of 2026-08-05 both wrote "ход
    // снимаю полем `waiting-on: —`" and passed nothing. The turn stayed on dev-core
    // from a notifier's letter and the pair was raised on a receiver where nothing had
    // happened — and an append-only feed has nothing to correct either message with.
    const contest = contour();

    const result = claiming(contest, "Разобрано. Ход снимаю полем `waiting-on: —`.\n", []);

    expect(result.code).toBe(2);
    expect(result.out).toContain("--waiting-on —");
    expect(filesIn(contest)).toEqual([]);
  });

  it("writes the very same body once the flag means it", () => {
    // The refusal is about the contradiction, never about the words: the intent of both
    // messages was legitimate and this is the one keystroke they were missing.
    const contest = contour();

    const result = claiming(contest, "Разобрано. Ход снимаю полем `waiting-on: —`.\n", [
      "--waiting-on",
      "—",
    ]);

    expect(result.code).toBe(0);
    const [file] = filesIn(contest);
    const message = parseMessageFile(
      readFileSync(join(contest.root, "016-x", "messages", file as string), "utf8"),
    );
    expect(message.fields.waitingOn).toBe(null);
  });

  it("lets a body QUOTING somebody else's turn through, flag or no flag", () => {
    // Measured, not assumed: over the live mail a scan for any mention of the markup
    // flags 7 messages and 5 of them merely quote another thread's field or a PR title.
    // The body is free text by contract; only the release form is read here.
    const contest = contour();

    const result = claiming(
      contest,
      "Перенос имеет дом: тред `023`, сообщение с `waiting-on: dev-core` и `parked-on: john`.\n",
      [],
    );

    expect(result.code).toBe(0);
    expect(filesIn(contest)).toHaveLength(1);
  });

  it("lets a fenced header EXAMPLE through — documenting the form is not using it", () => {
    const contest = contour();

    const result = claiming(contest, "Форма пустого ожидания:\n\n```\nwaiting-on: —\n```\n", []);

    expect(result.code).toBe(0);
    expect(filesIn(contest)).toHaveLength(1);
  });
});

describe("the same claim written without the markup (thread 058)", () => {
  it("REFUSES the sentence that REPORTS the rule while breaking it", () => {
    // Verbatim from 041/msg-019 of 2026-08-07. The markup-only door read it as free
    // text, the turn stayed on dev-core from a notifier's letter, and a session was
    // raised onto a receiver where main was green and the answer was already filed.
    const contest = contour();

    const result = claiming(
      contest,
      "Разбор уехал в `057`.\n\nХод отсюда не передаётся никому — сказано полем, а не прозой.\n",
      [],
    );

    expect(result.code).toBe(2);
    expect(result.out).toContain("--waiting-on —");
    expect(filesIn(contest)).toEqual([]);
  });

  it("REFUSES the other form the mail actually uses — 'ход никому не передаю'", () => {
    // Curator's wording on 032, 043 and 045: the same claim in the first person. All
    // three were harmless only because the thread was being closed in the same breath.
    const contest = contour();

    const result = claiming(contest, "Работы по треду не осталось, ход никому не передаю.\n", []);

    expect(result.code).toBe(2);
    expect(filesIn(contest)).toEqual([]);
  });

  it("writes the very same prose once the flag means it", () => {
    const contest = contour();

    const result = claiming(contest, "Ход отсюда не передаётся никому.\n", ["--waiting-on", "—"]);

    expect(result.code).toBe(0);
    const [file] = filesIn(contest);
    const message = parseMessageFile(
      readFileSync(join(contest.root, "016-x", "messages", file as string), "utf8"),
    );
    expect(message.fields.waitingOn).toBe(null);
  });

  it("lets an interim report KEEPING the turn through — a report does not end it", () => {
    // The line the language-neutral candidate would have crossed: "whoever holds the
    // turn must declare it" refuses 51 of the 942 messages written by the holder, and
    // this is what most of them look like.
    const contest = contour();

    const result = claiming(
      contest,
      "Первый шаг сделан, продолжаю в том же ходе. Ход у меня, по `042` ход у `curator`.\n",
      [],
    );

    expect(result.code).toBe(0);
    expect(filesIn(contest)).toHaveLength(1);
  });

  it("lets a message DESCRIBING the form through — inline code is cut for the prose form", () => {
    // Measured live, one minute after the form was written: the message reporting this
    // very change was refused, because describing the alternation puts "ход" and
    // `отсюда уходит` in one sentence. Prose about the protocol is the daily traffic of
    // these threads. The markup form still reads inline code — thread 042's two cases
    // were written that way.
    const contest = contour();

    const result = claiming(
      contest,
      "Прозаическая форма требует, чтобы «ход» стоял словом: `отсюда уходит | не переда[её]тся | никому не переда | снимаю`.\n",
      [],
    );

    expect(result.code).toBe(0);
    expect(filesIn(contest)).toHaveLength(1);
  });

  it("lets the machine writer of the trace class through — it has no flag BY DESIGN", () => {
    // The live cost of the wording, 2026-08-13: `ci-outcome.yml` wrote "чинить нечего,
    // ход не передаётся" on the trace class (`cancelled`/`skipped`/`neutral`/`stale`,
    // thread 048), where the flag is OMITTED rather than set to `—` — the turn is meant
    // to stay where the feed left it. The door read the sentence as a release claim and
    // refused the whole letter: run 31750839952, the `cancelled` outcome of E2E on
    // PR #279 was never written into 066 at all. The notifier now says what its header
    // does, and this is the sentence it says.
    const contest = contour();

    const result = claiming(
      contest,
      "⚪ **E2E по PR #279: `cancelled`.** Прогон не состоялся — чинить нечего, ход остаётся там, где его оставила лента.\n",
      [],
    );

    expect(result.code).toBe(0);
    expect(filesIn(contest)).toHaveLength(1);
  });

  it("lets the machine writer of the NO_ROUND note through — the second line of the same class", () => {
    // The other line `ci-outcome.yml` writes about the turn, fixed in the same commit as
    // the trace class above: the `ℹ️` note for a PR that touches `claude-review.yml` and
    // therefore gets no automatic review round. It used to end with "Ход не передаётся —
    // действия у автора здесь нет", which the door reads exactly like the trace class did,
    // and would have eaten the whole letter the first time an outcome landed on such a PR
    // (it never had — that is the only reason this branch had not fired yet). Untested,
    // the fix on this line could be undone tomorrow with nothing in CI turning red, which
    // is what reviewer-pr named on PR #280.
    const contest = contour();

    const result = claiming(
      contest,
      "✅ **CI по PR #281: `success`.**\n\nℹ️ Метку `review` вешать не нужно: дифф правит `.github/workflows/claude-review.yml`, а такому PR автоматический круг не положен по построению — действие пропускает своё ревью само («Skipping action due to workflow validation»). Ревью человеческое, merge за john (правило №14). Действия у автора здесь нет, поэтому ход остаётся там, где его оставила лента.\n",
      [],
    );

    expect(result.code).toBe(0);
    expect(filesIn(contest)).toHaveLength(1);
  });

  it("does not read 'ход' inside another word", () => {
    // 'переходит', 'находится', 'в этом ходе' — the lookarounds are what keep the
    // claim a word rather than a substring.
    const contest = contour();

    const result = claiming(
      contest,
      "Прогон переходит на пул ящика. В этом ходе ключ не передаётся в конфиг.\n",
      [],
    );

    expect(result.code).toBe(0);
    expect(filesIn(contest)).toHaveLength(1);
  });
});

describe("new-thread and the same claim (thread 042)", () => {
  it("REFUSES an opening message that releases the turn in prose only", () => {
    const contest = contour();
    const body = join(contest.repo, "opening.md");
    writeFileSync(body, "Стоячий приёмник. Ход никому: `waiting-on: —`.\n");

    const result = newThread({ ...contest, body }, "018-y", null);

    expect(result.code).toBe(2);
    expect(result.out).toContain("waiting-on");
    expect(existsSync(join(contest.root, "018-y"))).toBe(false);
  });
});
