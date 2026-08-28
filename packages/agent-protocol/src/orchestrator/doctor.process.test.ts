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

/**
 * THE SECTION THAT MUST NOT GO SILENT (the reviewer's finding on PR #206). Both rows of
 * the accounts section were added to the checklist only on a box that raises roles, so a
 * box declaring two subscriptions and no assigned role printed NOTHING about them — a
 * checklist byte-identical to that of a box with one login. It is asked here rather than
 * of the pure function alone because the defect was in the WIRING: which of the branches
 * a `doctor` run walks into, and the pure rows knew nothing about it.
 */
describe("doctor names the accounts of a box even when that box raises nothing", () => {
  /** A machine config for a name the repository does not declare — a bench (`boxRaisesNoRoles`). */
  const bench = (repo: string): void => {
    const dir = join(configHome(repo), "agent-protocol");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "local.json"),
      `${JSON.stringify(
        {
          agents: {},
          instance: "my-laptop",
          accounts: { second: { configDir: "/home/j/.claude-second" } },
        },
        null,
        2,
      )}\n`,
    );
  };

  it("keeps the row of a declared account, unasked and with the reason", () => {
    const { repo, work } = contour(true);
    bench(repo);
    const said = doctorIn(work, repo);
    expect(said).toContain("account: 'second' token");
    expect(said).toContain("no session here spends it");
    // The other half: it was NOT probed. A bench spends no token, and a row claiming a
    // live answer here would be the opposite defect.
    expect(said).not.toContain("CLAUDE_CONFIG_DIR=/home/j/.claude-second claude login");
  });
});

/**
 * TWO VENDORS ON ONE BOX, WHICH IS THE ONLY PLACE BOTH DEFECTS OF THREAD 039 EXIST.
 *
 * Measured on the live box 2026-08-28, `pnpm protocol doctor`:
 * `✗ account: 'codex-main' token: error: unknown option '--skip-git-repo-check'` — the
 * argv of the CODEX probe, refused by the CLAUDE binary, on an account that had just
 * been logged in. Two separate faults met in that one line: the row ran the first
 * binary the agent rows happened to resolve, and it printed the first line of whatever
 * came back. Neither is visible to a pure function — the first is a property of the
 * ORDER this command walks its workers in, and the second of what a real child writes
 * first — so the seam is measured here, with two fake binaries standing in for the
 * vendors and a probe that is allowed to run (no `--offline`).
 */
describe("doctor asks each account's own tool, and reports why the tool refused", () => {
  const TWO_KINDS = {
    ...CONFIG,
    instances: [{ id: "main", roles: ["dev-core", "pilot"] }],
    roles: [
      ...CONFIG.roles,
      {
        id: "pilot",
        kind: "codex",
        status: "active",
        wake: { mode: "watch", session: "p" },
        summary: "the second vendor",
        instructions: [{ kind: "in-repo", path: CARD }],
        // No allow-list: this tool has none, and the card says what holds the session
        // instead (thread 026, П1). Written out because the launch door refuses a codex
        // role that asks for a lever the tool lacks.
        launch: { agent: { kind: "codex", toolsHeldBy: "sandbox-read-only" } },
      },
    ],
  };

  /** A binary that refuses the way its vendor refuses — the whole fixture of this case. */
  const fake = (dir: string, name: string, lines: readonly string[]): string => {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${lines.map((l) => `echo '${l}' >&2`).join("\n")}\nexit 1\n`, {
      mode: 0o755,
    });
    return path;
  };

  const box = (): { readonly repo: string; readonly work: string } => {
    const { repo, work } = contour(true);
    // DECLARED IN THIS ORDER ON PURPOSE: claude first, so the row of a codex account is
    // wrong the moment it takes "the first binary that resolved" for its own.
    const bin = join(repo, "bin");
    mkdirSync(bin, { recursive: true });
    const claude = fake(bin, "claude", ["Not logged in · Please run /login"]);
    const codex = fake(bin, "codex", [
      // The vendor's real first line, captured on this box: progress, not a reason.
      "Reading additional input from stdin...",
      "ERROR: Reconnecting... 5/5",
      "ERROR: unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
    ]);
    const dir = join(configHome(repo), "agent-protocol");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "local.json"),
      `${JSON.stringify(
        {
          agents: { "claude-code": { exec: claude }, codex: { exec: codex } },
          instance: "main",
          accounts: { "codex-main": { configDir: "/root/.codex-pilot", kind: "codex" } },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(join(work, "agent-protocol.json"), `${JSON.stringify(TWO_KINDS, null, 2)}\n`);
    git(work, "add", "-A");
    git(work, "commit", "-qm", "a box that raises two vendors");
    return { repo, work };
  };

  /** The same command as above, but ALLOWED TO SPEND A PROBE: the fakes cost nothing. */
  const live = (cwd: string, repo: string): string => {
    const done = spawnSync(TSX, [CLI, "doctor", "--ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      env: {
        ...sandbox(configHome(repo)),
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    });
    return `${done.stdout ?? ""}${done.stderr ?? ""}`;
  };

  it("runs the codex binary for a codex account, though the claude one resolved first", () => {
    const { repo, work } = box();
    const said = live(work, repo);
    const row = said.split("\n").find((line) => line.includes("account: 'codex-main'")) ?? "";
    expect(row).toContain("401 Unauthorized");
    // What the defect printed instead: the words of the OTHER vendor's binary.
    expect(row).not.toContain("Not logged in");
  });

  it("names the reason the tool gave, not the first line it happened to write", () => {
    const { repo, work } = box();
    const said = live(work, repo);
    for (const row of said.split("\n").filter((line) => line.includes("(codex)"))) {
      // The line doctor used to print for this tool — progress, and nothing to repair.
      expect(row).not.toContain("Reading additional input from stdin");
    }
    expect(said).toContain("agent: headless run (codex)");
    expect(said).toContain("Missing bearer or basic authentication");
    // And the repair dictated beside the dead account is codex's, with its directory.
    expect(said).toContain("CODEX_HOME=/root/.codex-pilot");
  });
});
