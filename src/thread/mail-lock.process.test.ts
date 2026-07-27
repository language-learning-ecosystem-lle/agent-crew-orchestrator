/**
 * TWO DELIVERIES AT ONCE INTO ONE MAIL CHECKOUT (D-0, thread `023-daemon-parallelism`).
 *
 * This is the fact the whole lock exists for, and it can only be told by real
 * processes: the collision lives between the write and the commit, inside the working
 * directory, and a unit test with an injected git cannot get two of those into the same
 * directory at the same time.
 *
 * WHAT MAKES THE OVERLAP CERTAIN rather than lucky: a `pre-commit` hook in the mail
 * checkout that sleeps. Without it the two commands would most likely miss each other
 * by milliseconds and the test would pass on both the broken and the fixed code — the
 * worst kind of green. With it, the first delivery is demonstrably still inside the
 * checkout, with its message written and staged, while the second one arrives.
 *
 * Before the lock this ended one of two ways, both of them observed while writing it:
 * the second command refused with "the mail checkout has uncommitted changes", or the
 * first one's retry reset the second one's half-written message away.
 */
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

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
      id: "curator",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "k" },
      summary: "the keeper",
    },
  ],
};

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@e",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@e",
};

/** A bare remote, one checkout of the mail, one thread, and a slow `pre-commit` hook. */
const contour = (): { repo: string; root: string; body: string; remote: string } => {
  const remote = mkdtempSync(join(tmpdir(), "agent-protocol-lock-remote-"));
  execFileSync("git", ["-C", remote, "init", "-q", "--bare", "-b", "comms"]);

  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-lock-mail-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "comms"]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const thread = join(repo, "agent-comms", "023-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
      encoding: "utf8",
    });
  git("add", ".");
  git("commit", "-qm", "init");
  git("push", "-q", "origin", "comms");

  // The hook widens the window a delivery spends inside the dirty checkout. A real one
  // does the same thing for real reasons (the mail checkout carries commit-msg), so
  // this is the shape of the race in production, only slower.
  const hook = join(repo, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nsleep 2\n");
  chmodSync(hook, 0o755);

  const body = join(mkdtempSync(join(tmpdir(), "agent-protocol-lock-body-")), "body.md");
  writeFileSync(body, "The answer.\n");
  return { repo, root: join(repo, "agent-comms"), body, remote };
};

const send = (
  contest: { repo: string; root: string; body: string },
  from: string,
  to: string,
): Promise<{ code: number; out: string }> =>
  new Promise((resolve) => {
    const child = spawn(
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
        "023-x",
        "--from",
        from,
        "--expects",
        "answer",
        "--waiting-on",
        to,
        "--body-file",
        contest.body,
        "--write",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: sandbox(configHomeInside(contest.repo), {
          AGENT_PROTOCOL_WORKER: "claude-code",
          AGENT_PROTOCOL_SESSION_FILE: "",
          ...IDENTITY,
        }),
      },
    );
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });

describe("two deliveries into one mail checkout (D-0)", () => {
  it("both land in the feed: the second waits for the checkout instead of refusing or being reset away", {
    timeout: 60_000,
  }, async () => {
    const contest = contour();

    const [mine, theirs] = await Promise.all([
      send(contest, "dev-core", "curator"),
      send(contest, "curator", "dev-core"),
    ]);

    expect([mine.code, theirs.code]).toEqual([0, 0]);
    expect(`${mine.out}${theirs.out}`).not.toContain("uncommitted changes");

    // BOTH messages are in the REMOTE — the acceptance fact, not just "nothing threw".
    const files = execFileSync(
      "git",
      ["-C", contest.remote, "ls-tree", "-r", "--name-only", "comms"],
      { encoding: "utf8" },
    );
    expect(files).toMatch(/023-x\/messages\/.*-dev-core\.md/);
    expect(files).toMatch(/023-x\/messages\/.*-curator\.md/);

    // And the checkout is left clean and unlocked: the lock is a pass, not a residue.
    expect(
      execFileSync("git", ["-C", contest.repo, "status", "--porcelain"], { encoding: "utf8" }),
    ).toBe("");
    expect(existsSync(join(contest.repo, ".git", "agent-protocol-mail.lock"))).toBe(false);
  });
});
