/**
 * WHERE THE ROLES WORK, AS `status` PRINTS IT — the seam of thread 177 §3.2, and a process
 * test because the defect is exactly one of prediction: `workspaceInventoryOf` is a pure
 * function over directory names somebody hands it, and every unit of it hands them itself.
 * What no unit touches is the block asking the DISK — the block that walked the role list
 * and printed `workspacePath({role})` without ever looking for it. Above a ceiling of one
 * the session is seated in `<role>@<thread>` (`workspaceKeyOf`), so the old block named a
 * directory that is not there and said nothing about the two that are, and it did that
 * while staying green: a real `.worktrees` is the only thing that can say otherwise.
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

const configOf = (pairsPerRole: number) => ({
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: {
    state: ".orchestrator",
    mailCheckout: "mailco",
    ref: "HEAD",
    workdir: { worktrees: ".worktrees", branch: "main" },
  },
  ...(pairsPerRole === 1 ? {} : { parallelism: { pairsPerRole, pairsPerInstance: pairsPerRole } }),
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
    {
      id: "curator",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "keeper" },
      summary: "the keeper",
      instructions: [{ kind: "in-repo", path: "CARD.md" }],
      launch: { allowedTools: ["Bash"] },
    },
  ],
});

const threadMeta = (status: "open" | "closed"): string =>
  `---\ntitle: T\nparticipants: dev-core, curator\nstatus: ${status}\n---\n`;

/** A contour whose repository is the only thing under test. */
const contour = (
  pairsPerRole: number,
  threads: readonly (readonly [string, "open" | "closed"])[] = [],
): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-places-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify(configOf(pairsPerRole), null, 2)}\n`,
  );
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  mkdirSync(join(mail, "agent-comms"), { recursive: true });
  writeFileSync(join(mail, "agent-comms", "README.md"), "the mail\n");
  for (const [thread, state] of threads) {
    const dir = join(mail, "agent-comms", thread);
    mkdirSync(join(dir, "messages"), { recursive: true });
    writeFileSync(join(dir, "_meta.md"), threadMeta(state));
    writeFileSync(
      join(dir, "messages", "2026-09-09T05-20-10Z-curator.md"),
      [
        "---",
        "from: curator",
        "date: 2026-09-09T05:20:10Z",
        "expects: none",
        "waiting-on: dev-core",
        "---",
        "",
        "Carry on.",
        "",
      ].join("\n"),
    );
  }
  git(mail, "add", ".");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return repo;
};

/** A worktree made the way the orchestrator makes one — detached at the base. */
const workspace = (repo: string, name: string): void => {
  git(repo, "worktree", "add", "-q", "--detach", join(repo, ".worktrees", name), "HEAD");
};

const status = (repo: string): { code: number; out: string } => {
  const result = spawnSync(
    TSX,
    [
      CLI,
      "orchestrator",
      "status",
      "--ref",
      "HEAD",
      "--no-fetch",
      "--repo",
      repo,
      "--now",
      "2026-09-09T19:00:00Z",
    ],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

describe("`orchestrator status` — the workspaces this box actually has (thread 177)", () => {
  it("at the default ceiling it names the role's tree, exactly as before", () => {
    const repo = contour(1);
    workspace(repo, "dev-core");

    const result = status(repo);

    expect(result.out).toContain("workspaces (base");
    expect(result.out).toContain("  dev-core: ");
    // The role that has no tree is still named — silence about it would be the same
    // defect with the sign flipped.
    expect(result.out).toContain("  curator: ");
    expect(result.out).not.toContain("174-workspace-tidy-up");
    expect(result.code).toBe(0);
  });

  it("above the ceiling of one BOTH pairs of a role are named, and by their threads", () => {
    const repo = contour(2);
    workspace(repo, "dev-core@177-workspace-per-pair");
    workspace(repo, "dev-core@178-zones-door-silent-pass");

    const result = status(repo);

    expect(result.out).toContain("dev-core×177-workspace-per-pair: ");
    expect(result.out).toContain("dev-core×178-zones-door-silent-pass: ");
    expect(result.code).toBe(0);
  });

  it("a tree the ceiling left behind is named as stranded, with thread 218 as its home", () => {
    const repo = contour(2);
    workspace(repo, "dev-core");
    workspace(repo, "dev-core@177-workspace-per-pair");

    const result = status(repo);

    // Both are printed — the stranded one is a real tree and hiding it is the silence
    // this block exists to end — and only the stranded one carries the sentence.
    expect(result.out).toContain("dev-core×177-workspace-per-pair: ");
    expect(result.out).toContain("'parallelism.pairsPerRole' is 2");
    expect(result.out).toContain("no run will be seated in it again");
    expect(result.out).toContain("218-orphan-service-branches-and-dead-worktrees");
    expect(result.code).toBe(0);
  });

  /**
   * THE DRY INVENTORY OF THREAD 218, ON REAL TREES — and a process test because every sign
   * it judges by is read from somewhere else: the thread from a fold of the MAIL, the dirt
   * from `git status` in the tree, the price from `du` on the disk. A unit hands itself all
   * three and would stay green with the wiring crossed; the one thing that can say
   * otherwise is a `.worktrees` with a dead tree, a live one and a dirty one in it.
   *
   * AND THE ASSERTION THIS PACKAGE IS REALLY BOUGHT FOR IS THE LAST ONE: the count of
   * `git worktree list` before and after. The inventory is the package that runs a whole
   * release BEFORE anything may remove a tree, so "it removed nothing" is not a remark
   * about it — it is its specification.
   */
  it("prices the dead, spares the living, and REMOVES NOTHING", () => {
    const repo = contour(2, [
      ["001-done", "closed"],
      ["002-open", "open"],
    ]);
    workspace(repo, "dev-core@001-done");
    workspace(repo, "dev-core@002-open");
    workspace(repo, "curator@001-done");
    workspace(repo, "dev-core");
    // The trap of this whole rule: a tree whose name carries no thread, which is what the
    // mail checkout looks like. It must not reach a verdict at all.
    workspace(repo, "comms");
    writeFileSync(join(repo, ".worktrees", "curator@001-done", "left-behind.txt"), "mine\n");
    const before = git(repo, "worktree", "list");

    const result = status(repo);

    // The dead one: the thread is closed and every other sign says the tree is idle.
    expect(result.out).toContain("tidy-up: DEAD — thread 001-done is closed");
    // The living one, and the reason is the ONE sign that decided, not a general word.
    expect(result.out).toContain("tidy-up: alive — thread 002-open is OPEN");
    // The dirty one has a CLOSED thread and lives anyway — john's boundary of 12.09.
    expect(result.out).toContain("UNCOMMITTED CHANGES");
    // The role-keyed tree is out of the criterion's reach, neither dead nor alive.
    expect(result.out).toContain("tidy-up: not a pair");
    // `comms` is judged by nothing at all — it never reaches `workspaceLife`.
    const commsLine = result.out
      .split("\n")
      .find((line) => line.includes("comms: not any role's workspace")) as string;
    expect(commsLine).not.toContain("tidy-up:");
    expect(result.out).not.toContain("comms. Nothing here removes them");

    // The totals: one dead tree, priced MARGINALLY and against a named remainder.
    expect(result.out).toContain("dead pair trees (1)");
    expect(result.out).toContain("dev-core@001-done");
    // FOUR, and the number is the assertion: three other registered places plus the
    // UNOWNED `comms`. A remainder that left the unowned trees out would put their share
    // of the shared pool back into the figure as a saving.
    expect(result.out).toContain("would be freed while the other 4 registered place(s) stand");
    expect(result.out).toContain("role-keyed trees (1)");

    // AND NOTHING MOVED.
    expect(git(repo, "worktree", "list")).toBe(before);
    expect(result.code).toBe(0);
  });

  /**
   * THE SECOND PILE, SPLIT THE WAY IT IS READ (curator, 2026-09-17): what the tidy-up would
   * LEAVE BEHIND is a branch a tree is standing on right now, by name; the rest of the
   * box's local-only history is a count and a command.
   */
  it("names the branch a removal would leave behind, and only counts the rest", () => {
    const repo = contour(2, [["002-open", "open"]]);
    git(
      repo,
      "worktree",
      "add",
      "-q",
      "-b",
      "feat/left-behind",
      join(repo, ".worktrees", "dev-core@002-open"),
      "HEAD",
    );
    git(repo, "branch", "old/history-of-this-box");

    const result = status(repo);

    expect(result.out).toContain("branches a tidy-up would leave behind (1)");
    expect(result.out).toContain("dev-core@002-open → feat/left-behind");
    expect(result.out).toContain("other local-only branches (1)");
    // The rest is COUNTED, never listed: an arbitrary ten of hundreds is neither signal
    // nor completeness.
    expect(result.out).not.toContain("old/history-of-this-box");
    expect(result.code).toBe(0);
  });

  it("a tree under the workspaces that is no role's is named and judged by nothing", () => {
    const repo = contour(1);
    workspace(repo, "dev-core");
    workspace(repo, "probe-by-hand");

    const result = status(repo);

    expect(result.out).toContain("probe-by-hand: not any role's workspace");
    expect(result.code).toBe(0);
  });
});
