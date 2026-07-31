/**
 * DOCTOR IN A ROLE'S WORKSPACE — the wiring of the command, not the rows it renders.
 *
 * The rows are pure functions and are tested as such (`doctor.test.ts`). What cannot be
 * asked of a pure function is WHICH TREE the command judged, and that is the whole of
 * R26: the config is read at a ref OF THE CALLER'S TREE (`repoOf`), while the state of
 * the box hangs off the main checkout (`homeOf`). A role works in a linked worktree by
 * construction (R17), so `doctor --ref HEAD` typed there is the ordinary case, not an
 * exotic one — and mixing the two senses makes the row about the repository config a
 * judgement of one tree by the contents of another. It went out that way on PR #130 and
 * was caught in review; hence a process test over two real trees rather than a stub.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const CARD = "docs/roles/dev-core.md";

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
  instances: [{ id: "main", roles: ["dev-core"] }],
  roles: [
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the one" },
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
      instructions: [{ kind: "in-repo", path: CARD }],
      launch: { allowedTools: ["Bash"] },
    },
  ],
};

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

/**
 * A main checkout with the role card committed, and beside it a linked worktree of the
 * same repository whose HEAD is one commit further — with or without that card. The two
 * trees disagree ON PURPOSE: that disagreement is the only thing this file measures.
 */
const contour = (cardInWorktree: boolean): { readonly repo: string; readonly work: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-doctor-"));
  const repo = join(base, "work");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  mkdirSync(join(repo, "docs", "roles"), { recursive: true });
  writeFileSync(join(repo, CARD), "the card\n");
  mkdirSync(join(repo, "mailco"));
  writeFileSync(join(repo, "mailco", ".keep"), "");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config and card");

  const work = join(repo, ".worktrees", "dev-core");
  git(repo, "worktree", "add", "-q", "-b", "packet", work);
  if (cardInWorktree) {
    writeFileSync(join(work, CARD), "the card, edited\n");
  } else {
    rmSync(join(work, CARD));
  }
  git(work, "add", "-A");
  git(work, "commit", "-qm", "the packet");
  return { repo, work };
};

/**
 * The rows, whatever the code. The box of a test has no agent binary and no mail
 * branch, so the command legitimately ends red — and `spawnSync` (not `execFileSync`)
 * is what lets the rows be read anyway instead of the exit code becoming an exception.
 */
const doctorIn = (cwd: string, repo: string): string => {
  const done = spawnSync(TSX, [CLI, "doctor", "--ref", "HEAD", "--offline"], {
    cwd,
    encoding: "utf8",
    env: sandbox(configHome(repo)),
  });
  return `${done.stdout ?? ""}${done.stderr ?? ""}`;
};

describe("doctor judges the config of the tree it read the config from (R26)", () => {
  it("crosses a role card missing HERE, though the main checkout still has it", () => {
    const { repo, work } = contour(false);
    // The main checkout's HEAD carries the card, the worktree's HEAD does not. Judging
    // the wrong tree is a GREEN row about a config that does not hold together — the
    // failure mode that matters, since "doctor is green" is the acceptance criterion.
    expect(doctorIn(work, repo)).toContain(`instructions '${CARD}' are declared`);
  });

  it("does not invent a cross when the card is here and gone from the main checkout", () => {
    const { repo, work } = contour(true);
    git(repo, "rm", "-q", CARD);
    git(repo, "commit", "-qm", "the card moves");
    expect(doctorIn(work, repo)).not.toContain(`instructions '${CARD}' are declared`);
  });
});
