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
 *
 * AND THE SHIM IS NO LONGER REACHED THROUGH `PATH` (thread 221, П-3). Until this diff the
 * stand put its directory first on `PATH` and that was the whole of the interception — which
 * held only while the code under it asked `PATH` for the package manager. The moment the
 * levelling started resolving `pnpm` beside its own interpreter (thread 219's cure, in its
 * second call site), a `PATH`-shim stopped catching anything: the run went past it to the
 * real `pnpm` and two cases of this file would have become a genuine install inside a test.
 * A stand that catches the call only through the premise the code has just stopped standing
 * on is not a weaker stand — it is a stand that measures something else.
 *
 * SO THE INTERCEPTION IS MOVED TO WHERE THE RESOLUTION LOOKS. `resolveTool` forms its first
 * candidate from `dirname(process.execPath)`, so the stand gives the spawned CLI an
 * interpreter whose directory it owns: a `node` SYMLINK to the real binary (so every
 * `process.execPath` spawn the CLI makes — the background child among them — still runs a
 * real node) beside the recording `pnpm`, with `process.execPath` pointed at it through a
 * preloaded module. Nothing is copied and nothing is installed for real: what the box is
 * asked for is a symlink and a script (a node one since thread 219 — see `besideNodeStand`,
 * and the shim comment below for why the shell one measured less than it looked like).
 *
 * WHY A PRELOAD AND NOT A HARDLINK OF `node`. `process.execPath` is `/proc/self/exe`
 * resolved, so a symlinked interpreter reports the REAL directory and the shim would be
 * bypassed again; a hardlink beside the shim is refused on this box (`ln: Operation not
 * permitted` — the binary belongs to another user and `fs.protected_hardlinks` is on) and a
 * 118 MB copy per file is a price this suite should not pay. The one thing that is faked is
 * the WHEREABOUTS of the interpreter, which is the fact the stand is reproducing: a box
 * whose package manager lives beside its node. Everything else — the door, the borders, the
 * argv, the re-measurement — is the real code on a real disk.
 *
 * AND `PATH` NO LONGER CARRIES `pnpm` AT ALL, on purpose: every assertion in this file about
 * a call that DID happen is therefore an assertion about a call the caller's environment
 * could not have made, and every assertion about a call that did not happen cannot be
 * satisfied by the box's own `pnpm` being out of reach.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { type BesideNodeStand, besideNodeCalls, besideNodeStand } from "../testing/beside-node.js";
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
 * THE PACKAGE MANAGER, RECORDED — and it is found the way the code finds it: BESIDE THE
 * INTERPRETER (thread 221). `repair` is what a real `pnpm install` would leave behind —
 * without it the door re-measures the same stale build and refuses, which is the OTHER case
 * this file tests on purpose.
 *
 * AND IT IS A NODE SCRIPT, NOT A SHELL ONE (thread 219, john 2026-09-18). The shim the stand
 * used to write was `#!/bin/sh`, which needs no interpreter from anywhere — so these cases
 * went green with `env: toolEnv()` on the levelling spawn and equally green without it, and
 * the second half of thread 219's cure had no witness here at all. With a `#!/usr/bin/env
 * node` first line and a node-free `PATH` inside the CLI under test (both stated by
 * `besideNodeStand`), the shim runs only if the spawn carried the interpreter with it: take
 * the cure out and `pnpmCalls` is empty, which is what every case below reads.
 */
const pnpmShim = (repo: string, repair: boolean): BesideNodeStand =>
  besideNodeStand({
    dir: join(repo, "shim"),
    records: join(repo, ARGV),
    ...(repair
      ? {
          leaves: [
            'const tree = args[1] + "/node_modules/agent-protocol";',
            "fs.mkdirSync(tree, { recursive: true });",
            `fs.writeFileSync(tree + "/package.json", ${JSON.stringify(
              `{"name":"agent-protocol","version":"${CIRCUIT}"}\n`,
            )});`,
          ].join("\n"),
        }
      : {}),
  });

const pnpmCalls = (repo: string): string[] => besideNodeCalls(join(repo, ARGV));

/** The "session": it only records that it was started at all. */
const stub = (repo: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, `#!/bin/sh\npwd > ${join(repo, "cwd.txt")}\n`);
  chmodSync(path, 0o755);
  return path;
};

/**
 * THE `PATH` OF THE RUN, AND WHAT IS DELIBERATELY NOT ON IT (thread 221). `node` is here
 * because `tsx` is started through `#!/usr/bin/env node` and a `PATH` with no node at all
 * would never reach the CLI; `git` is here because the run is a real git operation. `pnpm`
 * is on it NOWHERE — neither the box's own nor the shim — so an install this file records
 * is one the environment could not have produced.
 */
const pathWithoutPnpm = (repo: string): string => {
  const dir = join(repo, "path");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, "node"))) symlinkSync(process.execPath, join(dir, "node"));
  return `${dir}:/usr/bin:/bin`;
};

const run = (
  repo: string,
  shim: BesideNodeStand,
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
      env: {
        ...sandbox(configHome(repo)),
        PATH: pathWithoutPnpm(repo),
        // WHERE THE INTERPRETER SAYS IT LIVES, and what the CLI is left to hand its own
        // children — the two facts the stand fakes, and the two the spawn under test reads.
        // They reach the background child too, which is the process that levels the tree in
        // the `--detach` cases.
        ...shim.env,
      },
    },
  );
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

describe("the box levels the workspace it issued (thread 180, john 2026-09-12)", () => {
  it("detached, clean, behind → the circuit installs INTO THAT TREE and the launch goes through", () => {
    const repo = contour();
    const tree = staleWorkspace(repo);
    const shim = pnpmShim(repo, true);

    const result = run(repo, shim);

    // The command was actually run, against that tree, in the form the doors have been
    // printing for a hand since thread 085.
    expect(pnpmCalls(repo)).toEqual(["--dir", tree, "install", "--frozen-lockfile"]);
    expect(result.out).toContain("levelling");
    // П-1 (thread 221): the package manager it started is the one BESIDE ITS OWN NODE, and
    // the premise is said out loud — the `PATH` this ran with carries no `pnpm` at all, so
    // the field failure of 17.09 has no second call site left here.
    expect(result.out).toContain(`running '${shim.pnpm}' (beside this node binary)`);
    expect(result.out).not.toContain("(from PATH");
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
   * HALF (б) — THE PARENT OF A BACKGROUND LAUNCH (thread 180, john's decision of
   * 2026-09-13). Until this diff the parent shared the plan's door because `write` is false
   * for both, and `-d` over a tree the grant COVERS died with code 2 at the very door the
   * grant told it to level. It is told apart by `background` and let through: the parent is
   * not the repairer — its child is — so what it owes the terminal is the fault, who repairs
   * it, and a process id.
   */
  it("Б1/Б4: the PARENT of a background launch over a tree the borders COVER → it forks, and says the CHILD levels", () => {
    const repo = contour();
    const tree = staleWorkspace(repo);

    const result = run(repo, pnpmShim(repo, true), ["--write", "--detach"]);
    // The child is a real background process which goes on to level that tree under its own
    // lock. It is ended here and now: what this case measures is the PARENT, and a session
    // left running would race every assertion after it.
    const child = /the supervisor went to the background, pid (\d+)/.exec(result.out);
    if (child !== null) {
      try {
        process.kill(-Number(child[1]), "SIGKILL");
      } catch {
        // Already gone — the parent's own line is the fact this case is about.
      }
    }

    // Б1: no refusal, and a child was born and named.
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("is not usable");
    expect(child).not.toBeNull();
    // Б2: the sentence names the CHILD as the one that levels — the parent prepares nothing,
    // and the plan's "this is a plan" would be a false sentence about a tree that is about
    // to be levelled for real.
    expect(result.out).toContain(
      `levelling — not run here — this run only forks: the child of this background launch levels the workspace of 'dev-core' onto the build the circuit runs (installing into '${tree}') under its own lock, and carries on`,
    );
    // Б4: the facts do not vanish from the terminal of whoever typed the command — the
    // stale build is still named in the door's own words.
    expect(result.out).toContain("DIFFERENT BUILD");
    // And the PARENT itself ran no package manager: its own output carries neither the line
    // the real levelling prints before the command nor the one it prints after.
    expect(result.out).not.toContain("levelling — installing");
    expect(result.out).not.toContain("a real launch would level");
  });

  /**
   * Б3 — THE NEGATIVE HALF, AND IT IS MACHINE-KEYED. What lets the parent through is
   * `levelling.install`, the plan's own answer about john's three borders, not a match on
   * the text of a refusal. So every fault the child would NOT repair ends the parent exactly
   * as it did before: by name, with code 2, and with no process id on the terminal.
   */
  for (const border of [
    {
      name: "the tree stands on the ROLE'S OWN branch",
      said: "levelling — stands aside: the workspace of 'dev-core' stands on 'dev-core/180-x'",
      set: (_repo: string, tree: string): void => {
        git(tree, "checkout", "-q", "-b", "dev-core/180-x");
      },
    },
    {
      name: "DIRT",
      said: "levelling — stands aside: the workspace of 'dev-core' has uncommitted changes",
      set: (_repo: string, tree: string): void => {
        writeFileSync(join(tree, "CARD.md"), "a session was writing here\n");
      },
    },
    {
      name: "a RESUME",
      said: "levelling — stands aside: the run resumes a session already in",
      set: (repo: string, _tree: string): void => {
        resumable(repo);
      },
    },
  ]) {
    it(`Б3: the PARENT of a background launch, OUT of the borders: ${border.name} → still code 2, and no child`, () => {
      const repo = contour();
      const tree = staleWorkspace(repo);
      border.set(repo, tree);

      const result = run(repo, pnpmShim(repo, true), ["--write", "--detach"]);

      expect(result.code).toBe(2);
      expect(result.out).toContain(border.said);
      expect(result.out).toContain(
        "is not usable: the workspace of 'dev-core' runs 'agent-protocol'",
      );
      // No fork: the one line that would name a child is absent, and nothing was written.
      expect(result.out).not.toContain("went to the background");
      expect(result.out).not.toContain("only forks");
      expect(pnpmCalls(repo)).toEqual([]);
      expect(versionIn(tree)).toBe(BEHIND);
      expect(existsSync(join(repo, "cwd.txt"))).toBe(false);
    });
  }

  /** `-d` is john's spelling, and the repair reaches the spelling he actually types. */
  it("Б1, john's spelling: `-d` over a covered tree forks exactly as `--detach` does", () => {
    const repo = contour();
    const tree = staleWorkspace(repo);

    const result = run(repo, pnpmShim(repo, true), ["--write", "-d"]);
    const child = /the supervisor went to the background, pid (\d+)/.exec(result.out);
    if (child !== null) {
      try {
        process.kill(-Number(child[1]), "SIGKILL");
      } catch {
        // Already gone.
      }
    }

    expect(result.code).toBe(0);
    expect(child).not.toBeNull();
    expect(result.out).toContain(
      `levelling — not run here — this run only forks: the child of this background launch levels the workspace of 'dev-core' onto the build the circuit runs (installing into '${tree}') under its own lock, and carries on`,
    );
  });

  /** Б6: the flag without `--write` is still a refusal — this diff does not touch it. */
  it("Б6: `--detach` without `--write` is still refused, in the same words", () => {
    const repo = contour();
    const tree = workspace(repo);
    git(repo, "worktree", "add", "-q", "--detach", tree, "HEAD");
    installed(tree, CIRCUIT);

    const result = run(repo, pnpmShim(repo, true), ["--detach"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain(
      "--detach without --write: a dry run prints its plan here, there is nothing to background",
    );
    expect(result.out).not.toContain("went to the background");
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
