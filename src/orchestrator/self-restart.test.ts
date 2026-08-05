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
  describeSelfRestartStand,
  parseSelfRestartMemory,
  renderSelfRestartMemory,
  SELF_RESTART_MAX_ATTEMPTS,
  selfRestartArgv,
  selfRestartVerdict,
  spawnSelfRestart,
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
});
