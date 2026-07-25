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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseMessageFile } from "./message.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const CONFIG = {
  protocolVersion: 1,
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

const write = (
  contest: { repo: string; root: string; body: string },
  env: NodeJS.ProcessEnv,
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
        "dev-core",
        "--expects",
        "answer",
        "--waiting-on",
        "curator",
        "--body-file",
        contest.body,
        "--write",
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

  it("no environment, no flags → no provenance, and the message is still written", () => {
    // The turn matters more than the metadata: a run that cannot name itself must
    // still be able to hand over. This is the one place where the field is allowed
    // to be missing rather than wrong.
    const contest = contour();

    const result = write(contest, {
      AGENT_PROTOCOL_WORKER: "",
      AGENT_PROTOCOL_SESSION_FILE: "",
    });

    expect(result.code).toBe(0);
    expect(written(contest.root).fields.worker).toBeUndefined();
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
