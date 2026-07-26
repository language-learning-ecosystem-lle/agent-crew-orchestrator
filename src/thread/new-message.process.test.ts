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
      { encoding: "utf8", stdio: "pipe", env: { ...process.env, ...env } },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

const write = (
  contest: { repo: string; root: string; body: string },
  env: NodeJS.ProcessEnv,
  ...extra: string[]
): { code: number; out: string } => run(contest, env, ["--write", ...extra]);

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
        ...(value === undefined ? [] : ["--waiting-on", value]),
      ];
      try {
        return {
          code: 0,
          out: execFileSync(TSX, argv, {
            encoding: "utf8",
            stdio: "pipe",
            env: { ...process.env, ...sessionEnv(contest.repo) },
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
