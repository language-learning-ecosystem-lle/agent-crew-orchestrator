/**
 * THE READ PATH ON THE REAL CLI: what the user is told when git cannot be ASKED, and
 * what the user is told when git ANSWERED "this is not a repository". Those are two
 * different facts and used to arrive as one sentence.
 *
 * MEASURED, 2026-08-28, thread 026: under `codex exec --sandbox read-only` (codex-cli
 * 0.150.1) the pilot's `thread show` died with
 *
 *     '…/.worktrees/comms/agent-comms' is not inside a git repository: spawnSync git EPERM
 *
 * on a mail checkout that IS inside a git repository — the refusal made a claim about
 * the directory when the true cause was that the parent could not start (or believed it
 * could not start) the child. Discipline 4: a door that refuses must name the cause it
 * actually has.
 *
 * WHAT THIS FILE CANNOT DO, said out loud: it does not reproduce the sandbox. There is
 * no codex, no apparmor profile and no vendor account on a CI runner, so the sandbox is
 * NOT covered by any check — the only sentry there is a live run. What is covered here
 * is the process-level behaviour the sandbox exposed, driven by a cause CI can produce:
 * a PATH with no git at all makes `spawnSync` fail exactly the way it fails when a child
 * cannot be started (`status: null`), which is the branch the wrong sentence came from.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "./schema/version.js";
import { configHomeInside, sandbox } from "./testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../node_modules/.bin/tsx", import.meta.url));

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
  ],
};

const META = "---\ntitle: A conversation\nparticipants: dev-core\nstatus: open\n---\n";

const MESSAGE =
  "---\nfrom: dev-core\ndate: 2026-08-28T10:00:00Z\nexpects: none\n---\n\nThe body.\n";

/** A mail checkout that is a real git repository, so "not a repository" would be a LIE. */
const mailbox = (): { repo: string; root: string } => {
  const repo = mkdtempSync(join(tmpdir(), "read-sandbox-"));
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "agent-protocol.json"), JSON.stringify(CONFIG, null, 2));
  const root = join(repo, "agent-comms");
  const messages = join(root, "026-thread", "messages");
  mkdirSync(messages, { recursive: true });
  writeFileSync(join(root, "026-thread", "_meta.md"), META);
  writeFileSync(join(messages, "2026-08-28T10-00-00Z-dev-core.md"), MESSAGE);
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@e",
    "commit",
    "-qm",
    "init",
  ]);
  return { repo, root };
};

const ARGS = (box: { repo: string; root: string }): string[] => [
  "thread",
  "show",
  "--thread",
  "026-thread",
  "--repo",
  box.repo,
  "--root",
  box.root,
  "--ref",
  "HEAD",
  "--no-fetch",
];

const show = (
  box: { repo: string; root: string },
  env: NodeJS.ProcessEnv,
): { code: number; out: string; err: string } => {
  const result = spawnSync(TSX, [CLI, ...ARGS(box)], { encoding: "utf8", env });
  return { code: result.status ?? 1, out: result.stdout ?? "", err: result.stderr ?? "" };
};

/**
 * The same command through the LOADER form (`node --import tsx <entry>`) instead of the
 * `tsx` binary. Two reasons, and both come from the same measurement: the `tsx` shim is
 * itself resolved through PATH, so it cannot be the vehicle for a no-git PATH; and under
 * the codex sandbox the shim is what dies first (its IPC listener is refused — `listen
 * EPERM` in `node:net`), so this is the form a confined role has to use anyway.
 */
const showViaLoader = (
  box: { repo: string; root: string },
  env: NodeJS.ProcessEnv,
): { code: number; out: string; err: string } => {
  const result = spawnSync(process.execPath, ["--import", "tsx", CLI, ...ARGS(box)], {
    encoding: "utf8",
    env,
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  });
  return { code: result.status ?? 1, out: result.stdout ?? "", err: result.stderr ?? "" };
};

describe("the mail read path — a refusal names the cause it actually has (thread 026)", () => {
  it("reads the thread when git is reachable — the baseline the refusals are measured against", () => {
    const box = mailbox();
    const result = show(box, sandbox(configHomeInside(box.repo)));

    expect(result.code).toBe(0);
    expect(result.out).toContain("The body.");
  });

  it("says it could not RUN git — and does not call a real repository 'not a repository'", () => {
    const box = mailbox();
    // An empty PATH is the cause CI can produce for "the child never started"; the
    // sandbox produced the same branch by refusing the spawn itself.
    const result = showViaLoader(box, { ...sandbox(configHomeInside(box.repo)), PATH: "" });

    expect(result.code).toBe(2);
    expect(result.err).toContain("could not run git for");
    expect(result.err).toContain("ENOENT");
    expect(result.err).not.toContain("is not inside a git repository");
  });

  it("still says 'not inside a git repository' when git RAN and answered exactly that", () => {
    const outside = mkdtempSync(join(tmpdir(), "read-sandbox-bare-"));
    mkdirSync(join(outside, "agent-comms"), { recursive: true });
    const result = show(
      { repo: outside, root: join(outside, "agent-comms") },
      sandbox(configHomeInside(outside)),
    );

    expect(result.code).toBe(2);
    expect(result.err).toContain("is not inside a git repository");
    // git's own words are carried through, so the reader sees WHAT git said.
    expect(result.err).toContain("fatal: not a git repository");
  });
});
