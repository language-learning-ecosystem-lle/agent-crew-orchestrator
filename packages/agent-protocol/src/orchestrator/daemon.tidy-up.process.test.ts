/**
 * THE ONE STEP OF THE TICK THAT DELETES (thread 218, package 2), tested against real
 * `git worktree` on a real repository and through the real process, because that is the
 * only place the defect it can have would live.
 *
 * `planTidyUp` and `runTidyUp` are pure and covered by units to the last prohibition; what
 * no unit can say is whether the DAEMON hands them the right facts. The criterion reads
 * the mail (is the thread closed), the disk (is the tree dirty, is it locked) and the fold
 * of the journal (is a session seated here) — three sources the tick joins, and a join is
 * exactly what a unit substitutes away. A wrong join here does not fail a test; it removes
 * somebody's checkout.
 *
 * SO THE ASSERTIONS ARE ABOUT THE DISK AFTER THE TICK, never only about the log.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  parallelism: { pairsPerRole: 2, pairsPerInstance: 2 },
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
  ],
};

const threadMeta = (status: "open" | "closed"): string =>
  `---\ntitle: T\nparticipants: dev-core, curator\nstatus: ${status}\n---\n`;

const contour = (threads: readonly (readonly [string, "open" | "closed"])[]): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-tidy-"));
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
        "waiting-on: curator",
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

const workspace = (repo: string, name: string): void => {
  git(repo, "worktree", "add", "-q", "--detach", join(repo, ".worktrees", name), "HEAD");
};

/**
 * A BINARY THAT EXISTS, and it is never spawned: this contour has no `.orchestrator/enabled`,
 * so no launch is planned at all. It is here for PREFLIGHT, which probes the agent binary
 * BEFORE the first tick and refuses to start the daemon when it cannot resolve it. Without
 * `--exec` the probe falls through to the vendor name on the PATH of whoever runs the suite
 * — present in a role's session, absent on the CI runner — and the daemon then dies at
 * `preflight failed — not starting`, before the step under test has run. A tick that never
 * happened is not an observation about the tidy-up, so the fixture names the path itself.
 */
const stub = (repo: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
};

/** ONE TICK, WITH LAUNCHES DISABLED: the tidy-up is not a consequence of a launch. */
const tick = (repo: string): { code: number; out: string } => {
  const result = spawnSync(
    TSX,
    [
      CLI,
      "orchestrator",
      "daemon",
      "--ref",
      "HEAD",
      "--no-fetch",
      "--repo",
      repo,
      "--once",
      "--exec",
      stub(repo),
      "--poll",
      "1",
    ],
    { cwd: repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(repo)) },
  );
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const trees = (repo: string): readonly string[] =>
  git(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

describe("the daemon's tidy-up — what one tick takes, and everything it leaves (thread 218)", () => {
  it("takes the dead pair tree, ANCHORS it first, and leaves every other tree standing", () => {
    const repo = contour([
      ["001-done", "closed"],
      ["002-open", "open"],
      ["003-done", "closed"],
    ]);
    workspace(repo, "dev-core@001-done"); // dead: closed thread, clean, unlocked, idle
    workspace(repo, "dev-core@002-open"); // alive: the thread is open
    workspace(repo, "dev-core@003-done"); // closed thread, but DIRTY
    workspace(repo, "dev-core"); // role-keyed: outside the criterion
    workspace(repo, "comms"); // the mail's shape — never any role's place
    writeFileSync(join(repo, ".worktrees", "dev-core@003-done", "mine.txt"), "uncommitted\n");
    const before = trees(repo);

    const result = tick(repo);

    // THE LOG NAMES WHAT IT TOOK, and the count of what it left standing.
    expect(result.out).toContain("tidy-up: taking 1 tree(s) this tick");
    expect(result.out).toContain("tidy-up: REMOVED dev-core@001-done");
    expect(result.out).toContain("put it back: git worktree add");

    // AND THE DISK AGREES WITH THE LOG — one tree fewer, and it is that one.
    const after = trees(repo);
    expect(before.length - after.length).toBe(1);
    expect(existsSync(join(repo, ".worktrees", "dev-core@001-done"))).toBe(false);
    for (const name of ["dev-core@002-open", "dev-core@003-done", "dev-core", "comms"]) {
      expect(existsSync(join(repo, ".worktrees", name))).toBe(true);
    }

    // THE ANCHOR IS THE WHOLE OF WHAT MAKES IT REVERSIBLE, and it exists.
    const anchor = git(repo, "rev-parse", "refs/tidy/dev-core@001-done").trim();
    expect(anchor).toMatch(/^[0-9a-f]{40}$/);
    // And putting it back is not a phrase in a log line — it works.
    git(repo, "worktree", "add", join(repo, ".worktrees", "dev-core@001-done"), anchor);
    expect(existsSync(join(repo, ".worktrees", "dev-core@001-done"))).toBe(true);
    expect(result.code).toBe(0);
  });

  it("stops at the ceiling of the tick and NAMES the dead trees it left for the next one", () => {
    const repo = contour([
      ["001-done", "closed"],
      ["002-done", "closed"],
      ["003-done", "closed"],
      ["004-done", "closed"],
    ]);
    for (const thread of ["001-done", "002-done", "003-done", "004-done"])
      workspace(repo, `dev-core@${thread}`);

    const result = tick(repo);

    // THE CONSTANT IS THREE (`TIDY_UP_PER_TICK`), and the fourth is named rather than
    // dropped — a ceiling that says nothing about what it held back is a silent cap.
    expect(result.out).toContain("tidy-up: taking 3 tree(s) this tick");
    expect(result.out).toContain("1 more dead tree(s) stand until the next tick");
    expect(result.out).toContain("dev-core@004-done");
    expect(existsSync(join(repo, ".worktrees", "dev-core@004-done"))).toBe(true);
    expect(trees(repo).length).toBe(2); // the main checkout and the one left standing
    expect(result.code).toBe(0);
  });

  it("says so when there is nothing to take — 'none' never reads as 'the step is gone'", () => {
    const repo = contour([["002-open", "open"]]);
    workspace(repo, "dev-core@002-open");

    const result = tick(repo);

    expect(result.out).toContain("tidy-up: nothing to take");
    expect(existsSync(join(repo, ".worktrees", "dev-core@002-open"))).toBe(true);
    expect(result.code).toBe(0);
  });

  /**
   * A TREE WHOSE THREAD THE MAIL DOES NOT CARRY IS NOT A CLOSED ONE. The whole criterion
   * rests on a positive answer from the mail, and "no such thread here" answers nothing —
   * this is the case in which a silent reading would take a tree on no evidence at all.
   */
  it("leaves a tree whose thread is in no thread of the mail read here", () => {
    const repo = contour([["001-done", "closed"]]);
    workspace(repo, "dev-core@999-never-existed");

    const result = tick(repo);

    expect(result.out).toContain("tidy-up: nothing to take");
    expect(existsSync(join(repo, ".worktrees", "dev-core@999-never-existed"))).toBe(true);
  });

  it("a LOCKED tree with a closed thread is left standing, and the lock is why", () => {
    const repo = contour([["001-done", "closed"]]);
    workspace(repo, "dev-core@001-done");
    git(
      repo,
      "worktree",
      "lock",
      "--reason",
      "a hand is in here",
      join(repo, ".worktrees", "dev-core@001-done"),
    );

    const result = tick(repo);

    expect(result.out).toContain("tidy-up: nothing to take");
    expect(existsSync(join(repo, ".worktrees", "dev-core@001-done"))).toBe(true);
  });
});
