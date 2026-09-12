/**
 * THE LEVELLING AT THE LAUNCH DOOR, AS A PROCESS (thread
 * `180-selfheal-leaves-the-workspaces-behind`, john's half (а)) — because the whole
 * subject is a WRITE INTO SOMEBODY'S TREE, and the unit above it can only say whether the
 * decision was taken. Whether a package manager was actually started, against which tree,
 * and whether the trees john put out of bounds were left alone, exists only outside this
 * process: the evidence here is the SHIM'S OWN RECORD of how it was called, and its
 * absence in every case where it must not be called at all — the two borders, the healthy
 * tick, and the dry run, which is the only one of them told by what the PLAN says.
 *
 * WHY A SHIM AND NOT `pnpm`. A real install would make this file a network test with a
 * minute of runtime per case, and it would prove less: what is under test is the door's
 * decision and the command it forms, not pnpm's ability to install. The shim records its
 * argv and — in the case that must go through — repairs the tree the way a real install
 * would, so that the RE-MEASUREMENT after it (which is the other half of the change) is
 * exercised against a disk that actually changed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
    workdir: { branch: "main", worktrees: ".worktrees" },
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
  ],
};

const META = "---\ntitle: T\nparticipants: dev-core, curator\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nThe body.\n";

/** The build the circuit runs, and the one a tree left behind is standing on. */
const CIRCUIT = "0.2.14";
const BEHIND = "0.2.13";

/**
 * A CONTOUR THAT INSTALLS THE PACKAGE — which is what a CONSUMING contour looks like, and
 * the only shape in which the version door has anything to compare at all: the protocol's
 * own repository installs no copy of itself, so the door there is silent by design.
 */
const contour = (): string => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-level-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "the role card\n");
  writeFileSync(join(repo, ".gitignore"), ".worktrees/\n.orchestrator/\nmailco/\nnode_modules/\n");
  writeFileSync(
    join(repo, "package.json"),
    `${JSON.stringify({ name: "consumer", dependencies: { "agent-protocol": `github:x#v${CIRCUIT}` } }, null, 2)}\n`,
  );
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const thread = join(mail, "agent-comms", "012-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "mail");
  git(mail, "push", "-q", "-u", "origin", "comms");

  installed(repo, CIRCUIT);
  return repo;
};

/** The manifest of the package as it is installed in a tree — the whole of what is compared. */
const installed = (tree: string, version: string): void => {
  const dir = join(tree, "node_modules", "agent-protocol");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "agent-protocol", version })}\n`,
  );
};

const workspace = (repo: string): string => join(repo, ".worktrees", "dev-core");

/** The tree exactly as the orchestrator issues it — detached at the base — but behind. */
const staleWorkspace = (repo: string): string => {
  const tree = workspace(repo);
  git(repo, "worktree", "add", "-q", "--detach", tree, "HEAD");
  installed(tree, BEHIND);
  return tree;
};

const ARGV = "pnpm-argv.txt";

/**
 * THE PACKAGE MANAGER, RECORDED. `repair` is what a real `pnpm install` would leave behind
 * — without it the door re-measures the same stale build and refuses, which is the OTHER
 * case this file tests on purpose.
 */
const pnpmShim = (repo: string, repair: boolean): string => {
  const dir = join(repo, "shim");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "pnpm");
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' "$@" >> ${join(repo, ARGV)}\n` +
      (repair
        ? `mkdir -p "$2/node_modules/agent-protocol"\nprintf '{"name":"agent-protocol","version":"${CIRCUIT}"}\\n' > "$2/node_modules/agent-protocol/package.json"\n`
        : "") +
      "exit 0\n",
  );
  chmodSync(path, 0o755);
  return dir;
};

const pnpmCalls = (repo: string): string[] => {
  const path = join(repo, ARGV);
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
};

/** The "session": it only records that it was started at all. */
const stub = (repo: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, `#!/bin/sh\npwd > ${join(repo, "cwd.txt")}\n`);
  chmodSync(path, 0o755);
  return path;
};

const run = (
  repo: string,
  shim: string,
  argv: readonly string[] = ["--write"],
): { code: number; out: string } => {
  const result = spawnSync(
    TSX,
    [
      CLI,
      "orchestrator",
      "run",
      "--ref",
      "HEAD",
      "--no-fetch",
      "--repo",
      repo,
      "--role",
      "dev-core",
      "--thread",
      "012-x",
      "--exec",
      stub(repo),
      "--wall-clock",
      "20",
      "--poll",
      "1",
      ...argv,
    ],
    {
      cwd: repo,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...sandbox(configHome(repo)), PATH: `${shim}:${process.env.PATH ?? ""}` },
    },
  );
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

describe("the box levels the workspace it issued (thread 180, john 2026-09-12)", () => {
  it("detached, clean, behind → the circuit installs INTO THAT TREE and the launch goes through", () => {
    const repo = contour();
    const tree = staleWorkspace(repo);

    const result = run(repo, pnpmShim(repo, true));

    // The command was actually run, against that tree, in the form the doors have been
    // printing for a hand since thread 085.
    expect(pnpmCalls(repo)).toEqual(["--dir", tree, "install", "--frozen-lockfile"]);
    expect(result.out).toContain("levelling");
    // And the launch is no longer refused: the session was started in the tree that was
    // repaired a moment earlier. This is the standstill of 2026-09-09, ended.
    expect(result.out).not.toContain("DIFFERENT BUILD");
    expect(existsSync(join(repo, "cwd.txt"))).toBe(true);
  });

  it("the install did not repair it → the door's OWN refusal, unchanged, and no session", () => {
    const repo = contour();
    staleWorkspace(repo);

    const result = run(repo, pnpmShim(repo, false));

    expect(pnpmCalls(repo)).toHaveLength(4);
    // The fault is never quieter after the right exists than it was before it: the
    // refusal is the door's text, with the repair a hand runs.
    expect(result.out).toContain("DIFFERENT BUILD");
    expect(result.out).toContain("install --frozen-lockfile");
    expect(existsSync(join(repo, "cwd.txt"))).toBe(false);
  });

  it("border 1: the tree stands on the ROLE'S OWN branch → nothing is run and it is refused", () => {
    const repo = contour();
    const tree = staleWorkspace(repo);
    git(tree, "checkout", "-q", "-b", "dev-core/180-x");

    const result = run(repo, pnpmShim(repo, true));

    // Not a single call — the tree may carry unlanded work, and john's border is that the
    // circuit does not write into it at all.
    expect(pnpmCalls(repo)).toEqual([]);
    expect(result.out).toContain("DIFFERENT BUILD");
    expect(result.out).toContain("dev-core/180-x");
    expect(existsSync(join(repo, "cwd.txt"))).toBe(false);
  });

  it("border 2: a DIRTY tree → nothing is run, and the dirt keeps its own path (thread 099)", () => {
    const repo = contour();
    const tree = staleWorkspace(repo);
    writeFileSync(join(tree, "CARD.md"), "a session was writing here\n");

    const result = run(repo, pnpmShim(repo, true));

    expect(pnpmCalls(repo)).toEqual([]);
    expect(result.out).toContain("uncommitted");
    expect(existsSync(join(repo, "cwd.txt"))).toBe(false);
  });

  /**
   * THE DRY RUN'S OWN TWO HALVES (thread 180, curator's statement of 2026-09-12 §4) — the
   * case that until now was watched by an eye only, which is the class that is later
   * repaired blind. The two cases below are the SAME tree in the same fault, told apart by
   * one thing: whether john's borders cover it. What the plan says differs, and that
   * difference is the subject — so both halves are asserted by SUBSTRING, and the refusal
   * itself (code and reason) is asserted in both, because a line about levelling must never
   * become a refusal of its own.
   */
  it("a DRY run over a tree OUT of the borders → the border is said by name, and nothing is run", () => {
    const repo = contour();
    const tree = staleWorkspace(repo);
    git(tree, "checkout", "-q", "-b", "dev-core/180-x");

    const result = run(repo, pnpmShim(repo, true), []);

    // The reason is john's border and not this run's mode, so it is true of the real launch
    // too: whoever is deciding whether to repair that tree by hand learns that the circuit
    // will not, and why.
    expect(result.out).toContain(
      "levelling — stands aside: the workspace of 'dev-core' stands on 'dev-core/180-x'",
    );
    // A dry run writes nowhere by definition, and the refusal is the door's own, unchanged.
    expect(pnpmCalls(repo)).toEqual([]);
    expect(result.code).toBe(2);
    expect(result.out).toContain(
      "is not usable: the workspace of 'dev-core' runs 'agent-protocol'",
    );
    expect(result.out).toContain("DIFFERENT BUILD");
    expect(existsSync(join(repo, "cwd.txt"))).toBe(false);
  });

  it("a DRY run over a tree the borders COVER → the refusal is unchanged, and about levelling it says NOTHING", () => {
    const repo = contour();
    staleWorkspace(repo);

    const result = run(repo, pnpmShim(repo, true), []);

    // THE SECOND HALF, NAMED EXPLICITLY: not one word about the levelling — neither the
    // border (none of the three fired) nor the repair the real launch would have run. The
    // assertion is the guard that keeps a dry run from ever REACHING the install: the same
    // line that is missing here is the one that would be printed a screen further down,
    // where `runWorkspaceInstall` actually starts a package manager.
    expect(result.out).not.toContain("levelling");
    expect(pnpmCalls(repo)).toEqual([]);
    // And the refusal is the stale build's own, unchanged by any of the above.
    expect(result.code).toBe(2);
    expect(result.out).toContain(
      "is not usable: the workspace of 'dev-core' runs 'agent-protocol'",
    );
    expect(result.out).toContain("DIFFERENT BUILD");
    expect(existsSync(join(repo, "cwd.txt"))).toBe(false);
  });

  it("a tree already on the circuit's build → no install, no line, and the session runs", () => {
    const repo = contour();
    const tree = workspace(repo);
    git(repo, "worktree", "add", "-q", "--detach", tree, "HEAD");
    installed(tree, CIRCUIT);

    const result = run(repo, pnpmShim(repo, true));

    // The silence of a healthy tick is a requirement, not an omission: this runs at every
    // launch of every role.
    expect(pnpmCalls(repo)).toEqual([]);
    expect(result.out).not.toContain("levelling");
    expect(existsSync(join(repo, "cwd.txt"))).toBe(true);
  });
});
