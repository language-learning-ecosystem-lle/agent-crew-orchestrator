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

/** The build a tree is standing on, read off the disk — `undefined` when nothing is installed. */
const versionIn = (tree: string): string | undefined => {
  const path = join(tree, "node_modules", "agent-protocol", "package.json");
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version
    : undefined;
};

/**
 * THE THIRD BORDER, AS A FIXTURE: a journal with one run of this pair broken from the
 * outside, which is what makes the next launch a RESUME. The world is recorded as it is
 * right now (the continuation asks whether it stood still), and the role has said nothing
 * in the thread yet — the empty mark is a fact, not an absence.
 */
const resumable = (repo: string): void => {
  const base = { ts: "2026-07-25T10:00:00Z", role: "dev-core", thread: "012-x" };
  const lines = [
    { kind: "lease-acquired", ...base, deadline: "2026-07-25T11:00:00Z" },
    {
      kind: "launch",
      ...base,
      mode: "fresh",
      world: { base: git(repo, "rev-parse", "origin/main").trim(), mine: "" },
    },
    {
      kind: "lease-released",
      ...base,
      reason: "supervisor-gone",
      session: "8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b",
      steps: 12,
    },
  ];
  mkdirSync(join(repo, ".orchestrator"), { recursive: true });
  writeFileSync(
    join(repo, ".orchestrator", "journal.jsonl"),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
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

/**
 * A DETACHED CHILD IS NOT THIS PROCESS'S TO LEAVE RUNNING (half (б)). The parent prints the
 * pid it forked; the group is ended by that number, and a child that is already gone is not
 * an error here — `ESRCH` means the thing this is for has happened by itself.
 */
const reapChild = (output: string): void => {
  const pid = Number(/went to the background, pid (\d+)/.exec(output)?.[1] ?? "");
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    /* already gone */
  }
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

  it("a DRY run over a tree OUT of the borders: DIRT → the border is said by name, and nothing is run", () => {
    const repo = contour();
    const tree = staleWorkspace(repo);
    writeFileSync(join(tree, "CARD.md"), "a session was writing here\n");

    const result = run(repo, pnpmShim(repo, true), []);

    expect(result.out).toContain(
      "levelling — stands aside: the workspace of 'dev-core' has uncommitted changes",
    );
    expect(pnpmCalls(repo)).toEqual([]);
    expect(result.code).toBe(2);
    expect(result.out).toContain(
      "is not usable: the workspace of 'dev-core' runs 'agent-protocol'",
    );
    expect(result.out).toContain("DIFFERENT BUILD");
    expect(existsSync(join(repo, "cwd.txt"))).toBe(false);
  });

  it("a DRY run over a tree OUT of the borders: a RESUME → the border is said by name, and nothing is run", () => {
    const repo = contour();
    staleWorkspace(repo);
    resumable(repo);

    const result = run(repo, pnpmShim(repo, true), []);

    expect(result.out).toContain("levelling — stands aside: the run resumes a session already in");
    expect(pnpmCalls(repo)).toEqual([]);
    expect(result.code).toBe(2);
    expect(result.out).toContain(
      "is not usable: the workspace of 'dev-core' runs 'agent-protocol'",
    );
    expect(result.out).toContain("DIFFERENT BUILD");
    expect(existsSync(join(repo, "cwd.txt"))).toBe(false);
  });

  /**
   * THE HALF THAT USED TO BE SILENT, NOW THE OUTCOME (thread 180, john's decision of
   * 2026-09-13) — the same tree and the same fault as the three cases above, told apart by
   * one thing: john's borders cover it. What the plan owes here is what the REAL launch
   * would do, and a refusal is not it: the real launch levels this tree and carries on.
   */
  it("a DRY run over a tree the borders COVER → it says the real launch would level it, and does NOT refuse", () => {
    const repo = contour();
    const tree = staleWorkspace(repo);

    const result = run(repo, pnpmShim(repo, true), []);

    // A1: the outcome of the real launch, in one line, and the plan goes on to print the
    // launch it planned instead of stopping at this tree.
    expect(result.out).toContain(
      `levelling — not run — this is a plan: a real launch would level the workspace of 'dev-core' onto the build the circuit runs (installing into '${tree}') and carry on`,
    );
    expect(result.code).toBe(0);
    // The plan did not stop at this tree: what follows is the launch it planned, which is
    // the same text a dry run prints over a healthy tree.
    expect(result.out).toContain("--write performs it");
    expect(result.out).not.toContain("is not usable");
    // A4: the stale build is still NAMED, in the door's own words — whoever is deciding
    // whether to repair that tree by hand loses nothing by the refusal going away.
    expect(result.out).toContain("DIFFERENT BUILD");
    // A3, and it is measured on the DISK rather than in the output: a dry run writes
    // nothing anywhere, so the tree is exactly as behind as it was.
    expect(pnpmCalls(repo)).toEqual([]);
    expect(versionIn(tree)).toBe(BEHIND);
    expect(existsSync(join(repo, "cwd.txt"))).toBe(false);
  });

  it("a DRY run over a tree with NO install at all → still nothing written, and no plan of one", () => {
    const repo = contour();
    const tree = workspace(repo);
    git(repo, "worktree", "add", "-q", "--detach", tree, "HEAD");

    const result = run(repo, pnpmShim(repo, true), []);

    // The other of the two faults one line repairs (thread 161): out of a dry run it is
    // not even measured, because the measurement would be of a tree this run deliberately
    // did not prepare. What matters here is the disk: `node_modules` did not appear.
    expect(pnpmCalls(repo)).toEqual([]);
    expect(existsSync(join(tree, "node_modules"))).toBe(false);
    expect(result.code).toBe(0);
  });

  /**
   * HALF (б), AND IT IS THE CASE HALF (а) DELIBERATELY LEFT RED-BY-DESIGN (thread 180, john's
   * decision of 2026-09-13 — curator's `msg-067`). `write` is false for the parent of a
   * background launch exactly as it is for a plan, which is why the two had to be told apart
   * by a flag of their own before either could move. This is the second of them: over a tree
   * the borders COVER, the parent no longer dies on a fault its own child repairs on the way
   * in.
   *
   * WHAT IS ASSERTED HERE IS EXACTLY WHAT THE PARENT ALONE DECIDES — that it does not refuse
   * (Б1) and that the terminal keeps both facts (Б4). THE DISK IS DELIBERATELY NOT ASSERTED
   * IN THIS CASE, and the reason is the subject of the diff rather than a gap in it: the
   * child is forked for real here, it inherits this test's PATH, and it levels that same tree
   * on its own clock. A `pnpmCalls(repo)).toEqual([])` beside a live child would be a race
   * dressed as a measurement — red or green by scheduling. Б2 is measured where it is
   * measurable: in the border cases below, where the parent refuses and no child exists, and
   * by the `input.write` guard that the levelling point carries (held by the dry-run cases
   * above, which share that guard with the parent).
   */
  for (const flag of ["--detach", "-d"] as const) {
    it(`the PARENT of a background launch (${flag}) over a COVERED tree → no refusal, and the child levels it`, () => {
      const repo = contour();
      staleWorkspace(repo);

      const result = run(repo, pnpmShim(repo, true), ["--write", flag]);
      // The child is a real detached process in its own group: it is ended before anything is
      // asserted, so that nothing of this case outlives it into the rest of the suite.
      reapChild(result.out);

      // Б1: the launch is not ended here. The defect half (б) closes is exactly this exit 2.
      expect(result.code).toBe(0);
      expect(result.out).not.toContain("is not usable");
      // Б4: the fault keeps the door's own words, and the line beside it names WHO repairs
      // it. Not the plan's conditional — this launch has a child, and it is being forked.
      expect(result.out).toContain("DIFFERENT BUILD");
      expect(result.out).toContain("the child of this background launch levels the workspace");
      expect(result.out).not.toContain("a real launch would level");
      expect(result.out).toContain("the supervisor went to the background");
    });
  }

  /**
   * Б3, THE NEGATIVE HALF, ONE CASE PER FAULT THE CHILD WOULD NOT REPAIR. The difference has
   * to be the MACHINE sign — the parent forks in exactly the case the plan would have said
   * `install: true` — and these three are what says it is not a coincidence of text: each
   * tree is behind on its build in the same way as the case above, and each is refused,
   * because a border stands in front of the levelling. A dirty tree may carry a session's
   * unlanded work, a tree on the role's own branch is not the circuit's to move, and a resume
   * is a tree somebody is still in.
   */
  for (const border of [
    {
      name: "the role's OWN branch",
      said: "dev-core/180-x",
      set: (_repo: string, tree: string): void => {
        git(tree, "checkout", "-q", "-b", "dev-core/180-x");
      },
      argv: ["--write"] as const,
    },
    {
      name: "DIRT",
      said: "uncommitted",
      set: (_repo: string, tree: string): void => {
        writeFileSync(join(tree, "CARD.md"), "a session was writing here\n");
      },
      argv: ["--write"] as const,
    },
  ]) {
    it(`Б3: the parent of a background launch over a tree OUT of the borders (${border.name}) still dies with 2`, () => {
      const repo = contour();
      const tree = staleWorkspace(repo);
      border.set(repo, tree);

      const result = run(repo, pnpmShim(repo, true), [...border.argv, "--detach"]);

      expect(result.code).toBe(2);
      expect(result.out).toContain(border.said);
      // Neither the child's sentence nor the plan's: nothing is going to level this tree, and
      // saying otherwise would be the new silence replacing the old one.
      expect(result.out).not.toContain("the child of this background launch levels");
      expect(pnpmCalls(repo)).toEqual([]);
      expect(versionIn(tree)).toBe(BEHIND);
      expect(existsSync(join(repo, "cwd.txt"))).toBe(false);
    });
  }

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
