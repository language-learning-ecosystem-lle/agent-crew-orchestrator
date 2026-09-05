/**
 * THE SERVICE BRANCHES IN THE OPERATOR'S SUMMARY (B.3, thread `099-dirty-tree-locks-the-role`;
 * john's §3 point 3 — "ветка не живёт вечно молча: возраст называется в сводке").
 *
 * WHY A PROCESS TEST AND NOT ONLY UNITS. `describeServiceBranches` is a pure function over a
 * list of names somebody hands it, and every unit of it builds that list itself. The SEAM —
 * `status` asking git for `refs/heads/wip/`, in the repository the summary already names, and
 * printing what comes back — is called by no unit at all. A wrong namespace, a `--format` that
 * prints full ref names, or the block falling out of a refactor would leave a green package and
 * a summary that says "none" over a repository holding somebody's uncommitted work: exactly the
 * silence B.3 exists to close, wearing the words that close it.
 *
 * AND THE LINKED-WORKTREE FACT IS PART OF THE SEAM. The block makes ONE git call for every role
 * because worktrees share `.git`; a branch made in a role's worktree has to reach this summary,
 * and only a real repository can say whether it does.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: {
    state: ".orchestrator",
    mailCheckout: "mailco",
    ref: "HEAD",
    workdir: { worktrees: ".worktrees", branch: "main" },
  },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
      instructions: [{ kind: "in-repo", path: "CARD.md" }],
      launch: { allowedTools: ["Bash"] },
    },
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  ],
};

/** A contour whose mail is empty and whose repository is the only thing under test. */
const contour = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-wip-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  mkdirSync(join(mail, "agent-comms"), { recursive: true });
  writeFileSync(join(mail, "agent-comms", "README.md"), "the mail\n");
  git(mail, "add", ".");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

/** stdout AND stderr together: a refusal of this command is an answer to read, not to lose. */
const status = (repo: string, now: string): { code: number; out: string } => {
  const result = spawnSync(
    TSX,
    [CLI, "orchestrator", "status", "--ref", "HEAD", "--no-fetch", "--repo", repo, "--now", now],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const NOW = "2026-09-08T15:31:00Z";

describe("`orchestrator status` — the service branches and how old they are", () => {
  it("says 'none' out loud over a repository that has none", () => {
    const result = status(contour(), NOW);

    expect(result.out).toContain("service branches: none");
    expect(result.code).toBe(0);
  });

  it("lists every one of them with its role, its thread and its AGE", () => {
    const repo = contour();
    // Made the way the tidy-up makes them: from a worktree of the role, which shares
    // `.git` with the repository the summary is pointed at.
    const workspace = join(repo, ".worktrees", "dev-core");
    git(repo, "worktree", "add", "-q", "--detach", workspace, "HEAD");
    git(workspace, "checkout", "-q", "-b", "wip/dev-core/099-dirty-tree-20260905T1231Z");
    writeFileSync(join(workspace, "left-behind.md"), "what the run did not commit\n");
    git(workspace, "add", ".");
    git(workspace, "commit", "-qm", "wip(099-dirty-tree): what the run left uncommitted");
    // And one nobody's hand made to the pattern — the namespace is not a lock.
    git(repo, "branch", "wip/by-hand");

    const result = status(repo, NOW);

    expect(result.out).toContain("service branches (2)");
    // The role, the thread and the age — the three questions asked a week later.
    expect(result.out).toContain("wip/dev-core/099-dirty-tree-20260905T1231Z");
    expect(result.out).toContain("thread 099-dirty-tree");
    expect(result.out).toContain("3d 3h old");
    // The unreadable one is COUNTED and listed, not quietly dropped.
    expect(result.out).toContain("wip/by-hand");
    expect(result.out).toContain("SAYS NEITHER WHOSE NOR WHEN");
    // And the end of the branch is named as a hand, since nothing here deletes one.
    expect(result.out).toContain("TAKES IT OR DROPS IT");
    expect(result.code).toBe(0);
  });

  it("a branch outside the 'wip/' namespace is no business of this block", () => {
    const repo = contour();
    git(repo, "branch", "feat/042-a-package");

    const result = status(repo, NOW);

    expect(result.out).toContain("service branches: none");
    expect(result.out).not.toContain("feat/042-a-package");
  });
});
