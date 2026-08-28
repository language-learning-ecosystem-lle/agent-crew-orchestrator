/**
 * The safety conditions of the self-restart (055.2) tested as a rule rather than as a
 * daemon: every case below is a state a box can be in at the moment its code falls
 * behind, and the whole point of the module is that none of them needs a process, a
 * clock or a checkout to be asserted about.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { HANG_CEILING_MS, waitFor } from "../testing/wait-for.js";
import { daemonArgvFor } from "./restart.js";
import {
  attemptsFor,
  describeInstallSkipped,
  describeSelfRestartForm,
  describeSelfRestartHandback,
  describeSelfRestartStand,
  describeSelfRestartStepFailed,
  describeSelfRestartWithheld,
  describeVersionRepair,
  describeVersionStand,
  describeVersionVerdictMet,
  INSTALL_INPUTS,
  installNeeded,
  parseSelfRestartMemory,
  renderSelfRestartMemory,
  SELF_RESTART_EXIT_CODE,
  SELF_RESTART_MAX_ATTEMPTS,
  selfRestartArgv,
  selfRestartForm,
  selfRestartVerdict,
  spawnSelfRestart,
  versionRepairVerdict,
} from "./self-restart.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const facts = {
  target: "b".repeat(40),
  running: [] as readonly string[],
  openLeases: [] as readonly string[],
  stopping: false,
  held: [] as readonly string[],
  tree: { kind: "clean" } as const,
  checkout: "/box/repo",
  served: "/box/repo",
  attempts: 0,
  ceiling: SELF_RESTART_MAX_ATTEMPTS,
};

describe("selfRestartVerdict", () => {
  it("goes on a clean idle box, and numbers the attempt", () => {
    expect(selfRestartVerdict(facts)).toEqual({
      kind: "go",
      target: facts.target,
      attempt: 1,
    });
  });

  it("stands while this daemon is running a session", () => {
    expect(selfRestartVerdict({ ...facts, running: ["dev-core"] })).toEqual({
      kind: "stand",
      block: { kind: "leases", roles: ["dev-core"] },
    });
  });

  it("counts a lease left open by a dead supervisor as a live session", () => {
    // The orphan is the case a `running` check alone would miss: this process holds
    // nothing, and yet somebody's turn is unclosed in the journal.
    expect(selfRestartVerdict({ ...facts, openLeases: ["curator/019"] })).toEqual({
      kind: "stand",
      block: { kind: "leases", roles: ["curator/019"] },
    });
  });

  it("names a running role once when it is also in the open leases", () => {
    const verdict = selfRestartVerdict({
      ...facts,
      running: ["dev-core"],
      openLeases: ["dev-core"],
    });
    expect(verdict).toEqual({ kind: "stand", block: { kind: "leases", roles: ["dev-core"] } });
  });

  it("stands while a stop is already down", () => {
    expect(selfRestartVerdict({ ...facts, stopping: true })).toEqual({
      kind: "stand",
      block: { kind: "stopping" },
    });
  });

  it("stands while a role is held by a manual session", () => {
    expect(selfRestartVerdict({ ...facts, held: ["dev-core"] })).toEqual({
      kind: "stand",
      block: { kind: "held", roles: ["dev-core"] },
    });
  });

  it("stands when the code came from one checkout and the daemon serves another", () => {
    // The measured case, not a supposed one: a process test of this package raises a
    // real daemon over a temporary repository while node loaded the modules from the
    // developer's own checkout, and `--ref` resolves THERE — so the drift is real and
    // the repair would pull a tree this daemon does not serve.
    const verdict = selfRestartVerdict({
      ...facts,
      checkout: "/box/lle/.worktrees/dev-core",
      served: "/tmp/agent-protocol-daemon-xyz/work",
    });
    expect(verdict).toEqual({
      kind: "stand",
      block: {
        kind: "foreign-checkout",
        code: "/box/lle/.worktrees/dev-core",
        served: "/tmp/agent-protocol-daemon-xyz/work",
      },
    });
  });

  it("says which two trees they are, so the reason is not a riddle", () => {
    const said = describeSelfRestartStand({
      kind: "foreign-checkout",
      code: "/box/code",
      served: "/box/served",
    });
    expect(said).toContain("/box/code");
    expect(said).toContain("/box/served");
  });

  it("never reports a foreign checkout's tidiness — the trees are two before it is dirty", () => {
    // Order matters here for the reason it does everywhere in this rule: a complaint
    // about uncommitted work in a tree this daemon does not serve is true and useless.
    expect(
      selfRestartVerdict({
        ...facts,
        served: "/somewhere/else",
        tree: { kind: "dirty", paths: ["?? scratch.md"] },
      }),
    ).toMatchObject({ block: { kind: "foreign-checkout" } });
  });

  it("stands over an uncommitted tree — the pull would move it", () => {
    const verdict = selfRestartVerdict({
      ...facts,
      tree: { kind: "dirty", paths: ["M packages/agent-protocol/src/cli.ts"] },
    });
    expect(verdict).toEqual({
      kind: "stand",
      block: {
        kind: "dirty",
        checkout: "/box/repo",
        paths: ["M packages/agent-protocol/src/cli.ts"],
      },
    });
  });

  it("treats an unreadable tree as a refusal, never as clean", () => {
    const verdict = selfRestartVerdict({
      ...facts,
      tree: { kind: "unreadable", problem: "not a git repository" },
    });
    expect(verdict).toEqual({
      kind: "stand",
      block: {
        kind: "tree-unreadable",
        checkout: "/box/repo",
        problem: "not a git repository",
      },
    });
  });

  it("stands once the ceiling for this target is reached", () => {
    expect(selfRestartVerdict({ ...facts, attempts: SELF_RESTART_MAX_ATTEMPTS })).toEqual({
      kind: "stand",
      block: { kind: "attempts", attempts: SELF_RESTART_MAX_ATTEMPTS, ceiling: 2 },
    });
  });

  it("still goes on the last attempt below the ceiling", () => {
    expect(selfRestartVerdict({ ...facts, attempts: 1 })).toEqual({
      kind: "go",
      target: facts.target,
      attempt: 2,
    });
  });

  it("puts work in flight before tidiness in the reason it gives", () => {
    // Both are true; the operator is told about the one that will change on its own.
    const verdict = selfRestartVerdict({
      ...facts,
      running: ["dev-core"],
      tree: { kind: "dirty", paths: ["?? scratch.md"] },
    });
    expect(verdict).toMatchObject({ block: { kind: "leases" } });
  });
});

describe("the memory of attempts", () => {
  it("survives a round trip", () => {
    const memory = { target: "c".repeat(40), attempts: 1, at: "2026-08-05T13:00:00Z" };
    expect(parseSelfRestartMemory(renderSelfRestartMemory(memory))).toEqual(memory);
  });

  it("refuses anything that is not the shape — a lost memory is zero attempts, not a wrong one", () => {
    for (const raw of ["", "not json", "{}", '{"target":"x","attempts":-1,"at":"t"}'])
      expect(parseSelfRestartMemory(raw)).toBeUndefined();
  });

  it("counts nothing for a target it does not remember — a new commit is a fresh repair", () => {
    const memory = { target: "c".repeat(40), attempts: 2, at: "2026-08-05T13:00:00Z" };
    expect(attemptsFor(memory, "c".repeat(40))).toBe(2);
    expect(attemptsFor(memory, "d".repeat(40))).toBe(0);
    expect(attemptsFor(undefined, "c".repeat(40))).toBe(0);
  });

  it("lets a box behind a NEW target try again after a ceiling was reached on the old one", () => {
    const memory = { target: "c".repeat(40), attempts: 2, at: "2026-08-05T13:00:00Z" };
    const verdict = selfRestartVerdict({
      ...facts,
      target: "d".repeat(40),
      attempts: attemptsFor(memory, "d".repeat(40)),
    });
    expect(verdict).toMatchObject({ kind: "go", attempt: 1 });
  });
});

describe("what is typed", () => {
  it("is the manual command, plus the mark that a daemon typed it", () => {
    const argv = selfRestartArgv({ ref: "origin/main", repo: "/box/repo", waitSec: 150 });
    expect(argv).toEqual([
      "orchestrator",
      "restart",
      "--pull",
      "--self",
      "--ref",
      "origin/main",
      "--repo",
      "/box/repo",
      "--wait",
      "150",
    ]);
  });

  it("names the instance the daemon was raised under, when it was raised under one", () => {
    // A box hosting several instances raises its daemon with `--instance <name>` (the
    // unit's own ExecStart does), and the repair that carried none resolved its config by
    // the checkout layer instead — right on this box, wrong on the box where the served
    // tree is claimed by another named config, and silent in both.
    expect(
      selfRestartArgv({ ref: "origin/main", repo: "/box/repo", waitSec: 150, instance: "crew" }),
    ).toEqual([
      "orchestrator",
      "restart",
      "--pull",
      "--self",
      "--ref",
      "origin/main",
      "--repo",
      "/box/repo",
      "--instance",
      "crew",
      "--wait",
      "150",
    ]);
  });

  it("names the config file the daemon was raised with — the layer nothing else reproduces", () => {
    // `--local-config <p>` has no other layer at all: it is not in the env, and the
    // checkout layer answers with a NAMED config, not with this path. A repair without it
    // works against another state directory — another pid file, another log, other holds.
    expect(
      selfRestartArgv({
        ref: "origin/main",
        repo: "/box/repo",
        waitSec: 150,
        localConfig: "/box/local.json",
      }),
    ).toEqual([
      "orchestrator",
      "restart",
      "--pull",
      "--self",
      "--ref",
      "origin/main",
      "--repo",
      "/box/repo",
      "--local-config",
      "/box/local.json",
      "--wait",
      "150",
    ]);
  });
});

describe("what the repair hands to the daemon it raises", () => {
  it("keeps the instance when the stopped daemon's saved flags are gone (055)", () => {
    // WHERE THE OMISSION BIT HARDEST, measured on the code rather than argued: `restart`
    // raises the successor with the STOPPED daemon's saved flags, and falls back to its
    // OWN argv when that file is missing or unreadable (`daemonArgvFor`). In that fallback
    // an identity the repair never carried is an identity the new daemon never gets —
    // on a multi-instance box, a daemon quietly raised as somebody else.
    const typed = selfRestartArgv({
      ref: "origin/main",
      repo: "/box/repo",
      waitSec: 150,
      instance: "crew",
    });
    const chosen = daemonArgvFor({ saved: undefined, typed });
    expect(chosen.source).toBe("typed");
    expect(chosen.argv).toContain("--instance");
    expect(chosen.argv[chosen.argv.indexOf("--instance") + 1]).toBe("crew");
    // And the repair's own flags do not travel with it — that is `restart`'s existing rule.
    expect(chosen.argv).not.toContain("--self");
  });
});

describe("where the child of the repair speaks", () => {
  it(
    "puts the REASON it died at the door into the daemon's log (055)",
    async () => {
      // THE REPRO THE ACCEPTANCE RUN NEEDED A HAND FOR. The child is given an argv the
      // door refuses — the same shape `--self` had on 2026-08-05, when the refusal went
      // into 'ignore' and the only trace on the box was 'attempted 2/2' with no cause.
      // Nothing of a daemon is raised: the spawn is the unit here, which is why it is a
      // function of this module and not four lines inside a tick (condition 3 keeps a
      // real 'go' repair — `restart --pull` over a real tree — out of this suite).
      const log = join(
        mkdtempSync(join(tmpdir(), "agent-protocol-selfrestart-log-")),
        "daemon.log",
      );
      const pid = spawnSelfRestart({
        node: TSX,
        nodeArgs: [],
        entry: CLI,
        argv: ["orchestrator", "restart", "--no-such-flag-at-all"],
        cwd: tmpdir(),
        logPath: log,
        env: process.env,
      });
      expect(pid).toBeGreaterThan(0);
      const spoke = await waitFor(
        () => existsSync(log) && readFileSync(log, "utf8").includes("--no-such-flag-at-all"),
      );
      expect(spoke).toBe(true);
      expect(readFileSync(log, "utf8")).toContain("does not understand what it was given");
    },
    HANG_CEILING_MS,
  );
});

describe("the line said instead", () => {
  it("names the blocking fact in every case, and never advises", () => {
    const lines = [
      describeSelfRestartStand({ kind: "leases", roles: ["dev-core"] }),
      describeSelfRestartStand({ kind: "stopping" }),
      describeSelfRestartStand({ kind: "held", roles: ["dev-core"] }),
      describeSelfRestartStand({ kind: "dirty", checkout: "/box/repo", paths: ["?? a"] }),
      describeSelfRestartStand({ kind: "tree-unreadable", checkout: "/box/repo", problem: "x" }),
      describeSelfRestartStand({ kind: "attempts", attempts: 2, ceiling: 2 }),
    ];
    for (const line of lines) expect(line.startsWith("no self-restart")).toBe(true);
    expect(lines[0]).toContain("dev-core");
    expect(lines[3]).toContain("/box/repo");
    expect(lines[5]).toContain("2/2");
  });

  // 003: the two dirty trees are two different repairs, and the line that calls both of
  // them "uncommitted work" sends the operator of the second one looking for a commit
  // to make. An untracked-only tree is fixed by an ignore rule and by nothing else.
  it("calls an untracked-only tree what it is, and names the repair for it", () => {
    const said = describeSelfRestartStand({
      kind: "dirty",
      checkout: "/box/repo",
      paths: ["?? .orchestrator/", "?? .worktrees/"],
    });
    expect(said).toContain("untracked files in '/box/repo'");
    expect(said).toContain(".orchestrator/");
    expect(said).toContain(".worktrees/");
    expect(said).toContain("NOTHING HERE IS WORK TO COMMIT");
    expect(said).toContain("ignore rule");
    expect(said).not.toContain("uncommitted work");
  });

  it("still calls a modified tree uncommitted work — one untracked path among them is not the other case", () => {
    const said = describeSelfRestartStand({
      kind: "dirty",
      checkout: "/box/repo",
      paths: ["M packages/agent-protocol/src/cli.ts", "?? .orchestrator/"],
    });
    expect(said).toContain("uncommitted work in '/box/repo'");
    expect(said).not.toContain("ignore rule");
  });
});

/**
 * CONDITION 6 IN WORDS (the live failure of 2026-08-07). The rule that stops the
 * half-death lives in the tick, and the process test drives it; this is the sentence it
 * says, held to the two things a reader of `daemon.log` needs from it — the pairs by name
 * and the reason, so that "nothing was launched" is never left to be inferred from an
 * absence of lines.
 */
describe("the line of a tick that hands over", () => {
  it("names the pairs it withheld and why they were withheld", () => {
    const said = describeSelfRestartWithheld(["dev-core×055-x", "curator×016-y"]);
    expect(said).toContain("this tick launches NOTHING");
    expect(said).toContain("dev-core×055-x, curator×016-y");
    // The reason is the load-bearing half: the wait of the repair is short BECAUSE the
    // leases are zero, and a session started now is what breaks that premise.
    expect(said).toContain("zero leases");
    expect(said).toContain("drain");
  });

  it("still speaks when the plan was empty — an invariant that only speaks when it bites cannot be checked", () => {
    const said = describeSelfRestartWithheld([]);
    expect(said).toContain("this tick launches nothing");
    expect(said).toContain("nothing to withhold");
  });
});

/**
 * WHICH FORM OF THE REPAIR THIS PROCESS CAN ACTUALLY USE (thread 003, 2026-08-18) — the
 * half of the decision that has no process in it, and the half where the defect of 17.08
 * lived. A daemon under a systemd unit spawned a child and left; `KillMode=control-group`
 * killed the child with the cgroup, the daemon exited 0, `Restart=on-failure` is blind to
 * a clean exit, and the box stood dark for eleven and a half hours.
 *
 * Reproduced on a stand of two units differing in that one key (2026-08-18): the child
 * took SIGTERM within a second of the parent's exit under `control-group` and ran every
 * phase to the end under `process`. So the mechanism is measured, not inferred — and the
 * repair is to stop needing a survivor rather than to weaken the unit's cleanup.
 */
describe("the form of the repair, and the exit that asks for a replacement", () => {
  it("reads the supervisor off the environment — INVOCATION_ID is set by systemd and by nothing else", () => {
    expect(selfRestartForm({ INVOCATION_ID: "9a1c" })).toBe("supervised");
    expect(selfRestartForm({})).toBe("detached");
    // An empty value is not a supervisor: an exported-but-blank variable is the shape a
    // shell leaves behind, and answering "supervised" to it would make a backgrounded
    // daemon leave for a supervisor that is not there.
    expect(selfRestartForm({ INVOCATION_ID: "" })).toBe("detached");
    expect(selfRestartForm({ INVOCATION_ID: "  " })).toBe("detached");
  });

  it("leaves with a NON-ZERO code — 'Restart=on-failure' is by construction blind to a clean exit", () => {
    expect(SELF_RESTART_EXIT_CODE).not.toBe(0);
    // Not the two this CLI already speaks: 1 is a refusal, 2 is the argument door, and a
    // journal in which the repair is spelled like either of them is a journal that lies.
    expect(SELF_RESTART_EXIT_CODE).not.toBe(1);
    expect(SELF_RESTART_EXIT_CODE).not.toBe(2);
  });

  it("says which mechanism it chose, and why the other one cannot work here", () => {
    const supervised = describeSelfRestartForm("supervised");
    expect(supervised).toContain("supervised");
    expect(supervised).toContain("nothing is spawned and no stop flag is set");
    expect(supervised).toContain("cgroup");
    expect(describeSelfRestartForm("detached")).toContain("not supervised");
  });

  it("names the code it leaves with AND what a supervisor that does not answer means", () => {
    const said = describeSelfRestartHandback("0123456789abcdef", SELF_RESTART_EXIT_CODE);
    expect(said).toContain("01234567");
    expect(said).toContain(`code ${SELF_RESTART_EXIT_CODE}`);
    // The failure mode is stated where the operator reads it: a unit without 'Restart='
    // turns this exit into a box that stays down, and silence about that is what made
    // the daemon of 17.08 indistinguishable from one that shut down on purpose.
    expect(said).toContain("DOWN");
  });

  it("cancels the exit when the repair failed — a process that came back to the same drift would loop", () => {
    const said = describeSelfRestartStepFailed(
      "git pull --ff-only",
      "not possible to fast-forward",
    );
    expect(said).toContain("NOT leaving");
    expect(said).toContain("stays up and behind");
    expect(said).toContain("not possible to fast-forward");
  });
});

/**
 * WHETHER THE INSTALLER HAS ANYTHING TO DO. It is asked because the repair runs it inside
 * the daemon's own process now: a needless `pnpm install` costs the box tens of seconds of
 * darkness and adds a network failure mode to the one path whose whole job is coming back.
 */
describe("whether a pull needs the installer run after it", () => {
  it("runs it when the pull moved what the installer reads — at the root or in a package", () => {
    expect(installNeeded(["package.json"])).toBe(true);
    expect(installNeeded(["pnpm-lock.yaml"])).toBe(true);
    expect(installNeeded(["pnpm-workspace.yaml"])).toBe(true);
    expect(installNeeded(["packages/agent-protocol/package.json"])).toBe(true);
    expect(installNeeded(["src/cli.ts", "packages/agent-protocol/pnpm-lock.yaml"])).toBe(true);
  });

  it("skips it when the pull moved only sources — the ordinary merge of this repository", () => {
    expect(installNeeded(["src/cli.ts", "docs/protocol-reference.md"])).toBe(false);
    expect(installNeeded([])).toBe(false);
    // A name that merely ENDS in one of the words is not one of them: 'my-package.json'
    // declares nothing, and a rule matching it would run the installer on a doc rename.
    expect(installNeeded(["docs/my-package.json"])).toBe(false);
  });

  it("says why it was skipped — silence there reads as 'it ran and said nothing'", () => {
    expect(describeInstallSkipped()).toContain("pnpm install skipped");
    for (const input of INSTALL_INPUTS) expect(describeInstallSkipped()).toContain(input);
  });
});

/**
 * THE VERDICT A DAEMON MEETS WHEN THE CONFIG IS AHEAD OF ITS BUILD (thread 040). Measured
 * on this repository three times in a week and finally read in the log on 2026-08-28: the
 * daemon answered it with `process.exit(2)`, which the unit of the box is told never to
 * restart, so one bump of `protocolVersion` left the circuit dead until a human pulled.
 * Every case below is the state a box can be in at that exact moment, and the rule that
 * decides between "repair and hand back" and "fall over once, loudly" needs none of a
 * process, a config or a clock to be asserted about — which is the point, because the
 * config is precisely what could not be read.
 */
describe("what a daemon does with a config newer than its build", () => {
  const clean = { kind: "clean" } as const;

  it("repairs when the code is behind the ref and the tree is clean — the pull IS the fix", () => {
    const verdict = versionRepairVerdict({
      code: { kind: "drift", refSha: "9f1c2b3d4e5f60718293a4b5c6d7e8f901234567" },
      tree: clean,
      checkout: "/srv/circuit",
      ref: "origin/main",
    });
    expect(verdict).toEqual({ kind: "repair", target: "9f1c2b3d4e5f60718293a4b5c6d7e8f901234567" });
    const said = describeVersionRepair(
      verdict.kind === "repair" ? verdict.target : "",
      "/srv/circuit",
    );
    expect(said).toContain("9f1c2b3d");
    expect(said).toContain("/srv/circuit");
  });

  /**
   * THE CASE A RESTART CANNOT FIX, and the one a naive "always exit for the supervisor"
   * would turn into a crash loop: the code already IS the ref. Nothing to pull, so what
   * the box needs is a newer build on the ref — said in those words, because an operator
   * reading "restart required" here would type the one command that changes nothing.
   */
  it("stands when the loaded code IS the ref — a pull would move nothing", () => {
    const verdict = versionRepairVerdict({
      code: { kind: "match" },
      tree: clean,
      checkout: "/srv/circuit",
      ref: "origin/main",
    });
    expect(verdict.kind).toBe("stand");
    if (verdict.kind !== "stand") return;
    expect(verdict.why).toContain("NEWER BUILD");
    expect(describeVersionStand(verdict.why, "/srv/circuit")).toContain("git pull --ff-only");
  });

  it("stands over uncommitted work — a pull there is the one irreversible step", () => {
    const verdict = versionRepairVerdict({
      code: { kind: "drift", refSha: "abcdef0123456789" },
      tree: { kind: "dirty", paths: [" M packages/agent-protocol/src/cli.ts"] },
      checkout: "/srv/circuit",
      ref: "origin/main",
    });
    expect(verdict.kind).toBe("stand");
    if (verdict.kind !== "stand") return;
    expect(verdict.why).toContain("packages/agent-protocol/src/cli.ts");
  });

  it("stands when the loaded code cannot be dated — a pull decided on nothing", () => {
    const verdict = versionRepairVerdict({
      code: { kind: "unknown", problem: "not a git checkout" },
      tree: clean,
      checkout: "/srv/circuit",
      ref: "origin/main",
    });
    expect(verdict.kind).toBe("stand");
    if (verdict.kind !== "stand") return;
    expect(verdict.why).toContain("not a git checkout");
  });

  /**
   * THE TWO LINES AN OPERATOR READS. The first has to say that the process is NOT taking
   * the argument door — that exit is what the unit is configured never to raise again —
   * and the second, on the ending that cannot be repaired, has to carry the whole command
   * a hand must type. A refusal from which the repair cannot be read is the defect this
   * package calls a silent door.
   */
  it("names the exit it is refusing to take, and the command a hand would type", () => {
    const met = describeVersionVerdictMet(
      "'agent-protocol.json' at origin/main: restart required: the repository declares protocol version 21, the package supports only 20",
      "origin/main",
    );
    expect(met).toContain("protocol version 21");
    expect(met).toContain("code 2");
    const stand = describeVersionStand("the loaded code IS 'origin/main'", "/srv/circuit");
    expect(stand).toContain("start limit stays intact");
    expect(stand).toContain("cd '/srv/circuit'");
    expect(stand).toContain("systemctl --user restart");
  });
});
