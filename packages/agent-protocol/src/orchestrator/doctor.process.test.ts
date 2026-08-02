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
  orchestrator: {
    state: ".orchestrator",
    mailCheckout: "mailco",
    ref: "HEAD",
    workdir: { branch: "main", worktrees: ".worktrees" },
  },
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
    // THE DEVELOPER'S OWN GIT CONFIG IS NOT PART OF THIS BOX: one of the rows measures
    // 'user.email' the way git resolves it (system → global → local → worktree), so a
    // machine whose global config is set would make the temp repository read as
    // configured — the case the row exists to catch would never be reachable in a test.
    env: {
      ...sandbox(configHome(repo)),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
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

/**
 * THE SIGNATURE OF THIS BOX, end to end (thread 019, task 019.1). The unit cases judge
 * the rule; what only a process can show is that the question is asked of GIT — the
 * commits here are made with an inline `-c user.email`, so the history is canonical
 * while the config is unset, which is exactly the box the history half calls green.
 */
describe("doctor asks what this box will sign the NEXT commit with", () => {
  it("crosses a checkout whose 'user.email' is unset — git would derive it from the hostname", () => {
    const { repo, work } = contour(true);
    const said = doctorIn(work, repo);
    expect(said).toContain("git: commit identity (this box)");
    expect(said).toContain("the checkout → 'nothing'");
    expect(said).toContain("hostname");
  });

  it("passes a checkout signed with the machinery's own address, and names the place", () => {
    const { repo, work } = contour(true);
    git(repo, "config", "user.email", "orchestrator@agents.invalid");
    const said = doctorIn(work, repo);
    expect(said).toContain("the checkout → 'orchestrator@agents.invalid'");
    expect(said).not.toContain("the checkout → 'nothing'");
  });

  it("crosses a workspace signing as a role nobody declared, though the checkout is right", () => {
    const { repo, work } = contour(true);
    git(repo, "config", "user.email", "orchestrator@agents.invalid");
    // How R17 signs a role's workspace: per-worktree config, which needs the extension.
    git(repo, "config", "extensions.worktreeConfig", "true");
    git(work, "config", "--worktree", "user.email", "dev-mobile@agents.invalid");
    // From the MAIN checkout: that is where the workspaces of the roles hang off, and
    // the point of the case is that a green checkout does not cover for them.
    const said = doctorIn(repo, repo);
    expect(said).toContain("the workspace of 'dev-core' → 'dev-mobile@agents.invalid'");
    expect(said).toContain("somebody who does not exist");
  });
});
