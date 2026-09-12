import { describe, expect, it } from "vitest";
import { type SelfRestartEvent, type SelfRestartMemory, selfRestartEvent } from "./self-restart.js";
import {
  describeDeliveredSelfRestartLetter,
  describeSuppressedSelfRestartLetter,
  describeSuppressedSelfRestartLetterStill,
  describeUndeliveredSelfRestartLetter,
  describeWithheldSelfRestartLetter,
  describeWithheldSelfRestartLetterStill,
  type ExecutableChange,
  executableChange,
  executableFootprint,
  planSelfRestartDelivery,
  planSelfRestartLetter,
  SELF_RESTART_QUIET_CADENCE,
  SELF_RESTART_SLUG,
  SELF_RESTART_WAITING_ON,
  type SelfRestartMemo,
  type SelfRestartQuietRun,
  selfRestartSignature,
} from "./self-restart-letter.js";

const root = "/srv/aco/.worktrees/comms/agent-comms";

/** A complete event — every one of the four facts john named is known. */
const full: SelfRestartEvent = {
  from: "fd1c14a671210777eebd6e36c449986bcded0a30",
  to: "7db145ba901a521621eaed0f1fb89a146ebec8c3",
  behind: 18,
  waitedForSec: 4230,
  repair: "went",
  wentAt: "2026-09-06T17:00:00Z",
  drainSince: "2026-09-06T15:49:30Z",
  at: "2026-09-06T17:00:00Z",
};

/** This circuit's shape: the daemon runs the package out of the checkout it is dated by. */
const source = executableFootprint({
  checkout: "/srv/aco",
  packageDir: "/srv/aco/packages/agent-protocol",
});

/** The restart moved code — the only case in which a letter is planned at all. */
const changed: ExecutableChange = {
  kind: "changed",
  paths: ["packages/agent-protocol/src/orchestrator/self-restart.ts"],
};

/** The flag's value, read out of the argv the plan hands to the child. */
const flagValue = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

describe("planSelfRestartLetter — the four facts john required", () => {
  it("says what the code WAS and what it BECAME", () => {
    const { body } = planSelfRestartLetter({ change: changed, event: full, root });
    expect(body).toContain("fd1c14a67121");
    expect(body).toContain("7db145ba901a");
  });

  it("says how far it was BEHIND", () => {
    expect(planSelfRestartLetter({ change: changed, event: full, root }).body).toContain(
      "18 коммит",
    );
  });

  it("says how long it WAITED for the sessions, in units a human reads", () => {
    expect(planSelfRestartLetter({ change: changed, event: full, root }).body).toContain(
      "1 ч 10 мин (4230 с)",
    );
  });

  it("names the moment it went — the stamp of the event, not of the letter", () => {
    expect(planSelfRestartLetter({ change: changed, event: full, root }).body).toContain(
      "2026-09-06T17:00:00Z",
    );
  });

  it("names the circuit when the caller knows it, and says nothing about one when it does not", () => {
    expect(
      planSelfRestartLetter({ change: changed, event: full, root, served: "/srv/aco" }).body,
    ).toContain("/srv/aco");
    expect(planSelfRestartLetter({ change: changed, event: full, root }).body).not.toContain(
      "**контур:**",
    );
  });
});

describe("planSelfRestartLetter — a fact that is NOT KNOWN is said, not dropped", () => {
  /** The whole complaint of this thread is that silence and absence look alike. */
  const old: SelfRestartEvent = { to: full.to, at: full.at, repair: "went", wentAt: full.at };

  it("says that the previous sha is not recorded, rather than leaving the line out", () => {
    const { body } = planSelfRestartLetter({ change: changed, event: old, root });
    expect(body).toContain("какой код был:");
    expect(body).toContain("не записано");
  });

  it("says that the distance is not recorded", () => {
    expect(planSelfRestartLetter({ change: changed, event: old, root }).body).toMatch(
      /сколько отставал:.*не записано/,
    );
  });

  it("says that the wait is not recorded — and never prints it as a zero", () => {
    const { body } = planSelfRestartLetter({ change: changed, event: old, root });
    expect(body).toMatch(/сколько ждал сессии:.*не записано/);
    expect(body).not.toContain("сколько ждал сессии:** 0 с");
  });

  it("says a short wait in seconds and a middling one in minutes", () => {
    expect(
      planSelfRestartLetter({ change: changed, event: { ...full, waitedForSec: 42 }, root }).body,
    ).toContain("сколько ждал сессии:** 42 с");
    expect(
      planSelfRestartLetter({ change: changed, event: { ...full, waitedForSec: 600 }, root }).body,
    ).toContain("10 мин (600 с)");
  });
});

describe("planSelfRestartLetter — the delivery it asks for", () => {
  it("posts into the STANDING ADDRESS, opening a receiver when none is open", () => {
    const { argv } = planSelfRestartLetter({ change: changed, event: full, root });
    expect(flagValue(argv, "--ensure-thread")).toBe(SELF_RESTART_SLUG);
    expect(flagValue(argv, "--title")).toBeDefined();
  });

  it("names participants — `--ensure-thread` refuses without them, at the door", () => {
    const participants = flagValue(
      planSelfRestartLetter({ change: changed, event: full, root }).argv,
      "--participants",
    );
    expect(participants?.split(",")).toContain("curator");
    expect(participants?.split(",")).toContain("github");
  });

  it("is sent from the system, expects nothing back, and still CARRIES A TURN", () => {
    const { argv, waitingOn } = planSelfRestartLetter({ change: changed, event: full, root });
    expect(flagValue(argv, "--from")).toBe("github");
    expect(flagValue(argv, "--expects")).toBe("none");
    expect(flagValue(argv, "--waiting-on")).toBe(SELF_RESTART_WAITING_ON);
    expect(waitingOn).toBe("curator");
  });

  it("hands the turn to a ROLE and not to a person: a turn on `john` raises nobody", () => {
    expect(planSelfRestartLetter({ change: changed, event: full, root }).waitingOn).not.toBe(
      "john",
    );
  });

  it("carries the mail's own location through to the child, and omits what it was not given", () => {
    const withAll = planSelfRestartLetter({
      change: changed,
      event: full,
      root,
      repo: "o/r",
      ref: "origin/main",
    });
    expect(flagValue(withAll.argv, "--root")).toBe(root);
    expect(flagValue(withAll.argv, "--repo")).toBe("o/r");
    expect(flagValue(withAll.argv, "--ref")).toBe("origin/main");
    expect(planSelfRestartLetter({ change: changed, event: full, root }).argv).not.toContain(
      "--repo",
    );
  });

  it("writes: the file, the commit and the push are one action", () => {
    expect(planSelfRestartLetter({ change: changed, event: full, root }).argv).toContain("--write");
  });
});

describe("selfRestartSignature — one restart is one letter", () => {
  it("is the SAME for the same event read again — the tick a minute later says nothing new", () => {
    expect(selfRestartSignature(full)).toBe(selfRestartSignature({ ...full }));
  });

  it("does not read the wall clock: nothing but the memory's own fields is in it", () => {
    const signature = selfRestartSignature(full);
    expect(signature).toContain(full.to);
    expect(signature).toContain(full.at);
  });

  it("is UNCHANGED by facts that cannot vary while `at` stands still", () => {
    expect(selfRestartSignature({ ...full, behind: 99, waitedForSec: 1 })).toBe(
      selfRestartSignature(full),
    );
  });

  it("is DIFFERENT for a second restart onto the same sha — two restarts are two events", () => {
    expect(selfRestartSignature({ ...full, at: "2026-09-06T19:00:00Z" })).not.toBe(
      selfRestartSignature(full),
    );
  });

  it("is DIFFERENT for a restart onto another sha", () => {
    expect(
      selfRestartSignature({ ...full, to: "0000000000000000000000000000000000000000" }),
    ).not.toBe(selfRestartSignature(full));
  });
});

describe("planSelfRestartDelivery — the lock on the repeat", () => {
  const memo: SelfRestartMemo = {
    signature: selfRestartSignature(full),
    at: "2026-09-06T17:00:05Z",
  };

  it("posts when nothing was ever posted", () => {
    expect(
      planSelfRestartDelivery({
        signature: selfRestartSignature(full),
        event: full,
        footprint: source,
        change: changed,
      }).post,
    ).toBe(true);
  });

  it("STAYS QUIET on the tick that re-reads the same file — and says why in the journal", () => {
    const plan = planSelfRestartDelivery({
      signature: selfRestartSignature(full),
      memo,
      event: full,
      footprint: source,
      change: changed,
    });
    expect(plan.post).toBe(false);
    if (plan.post === false) {
      expect(plan.said).toContain(SELF_RESTART_SLUG);
      expect(plan.said).toContain(memo.at);
    }
  });

  it("posts again for a NEW restart, though a letter about the previous one stands", () => {
    const next = selfRestartSignature({ ...full, at: "2026-09-06T19:00:00Z" });
    expect(
      planSelfRestartDelivery({
        signature: next,
        memo,
        event: full,
        footprint: source,
        change: changed,
      }).post,
    ).toBe(true);
  });
});

describe("the journal lines — a suppressed tick and a lost letter are both readable", () => {
  it("the suppressed line points at where the one letter is", () => {
    const said = describeSuppressedSelfRestartLetter({
      memo: { signature: "x", at: "2026-09-06T17:00:05Z" },
    });
    expect(said).toContain("SUPPRESSED");
    expect(said).toContain(SELF_RESTART_SLUG);
  });

  it("the undelivered line carries the EVENT, so the log alone reconstructs it", () => {
    const said = describeUndeliveredSelfRestartLetter({
      event: full,
      cause: "exit 1: push refused",
    });
    expect(said).toContain("NOT DELIVERED");
    expect(said).toContain("push refused");
    expect(said).toContain("7db145ba901a");
    expect(said).toContain(full.at);
    expect(said).toContain("STANDS");
  });

  it("the delivered line names the address the reader has to go to", () => {
    expect(describeDeliveredSelfRestartLetter()).toContain(SELF_RESTART_SLUG);
  });
});

/**
 * THE NARROWING (thread 161, john through curator): the letter goes only when the restart
 * CHANGED WHAT THIS DAEMON EXECUTES. The field case it answers is the consumer circuit's:
 * a drift of two markdown files under `docs/` drained a live session and bought a turn.
 */
describe("executableFootprint — what the box runs, in both shapes it comes in", () => {
  it("running FROM SOURCE: the package directory of the entry, relative to the checkout", () => {
    expect(source.dirs).toEqual(["packages/agent-protocol"]);
    expect(source.whole).toBe(false);
    expect(source.means).toContain("packages/agent-protocol");
  });

  it("running an INSTALLED package: no path of the checkout, and the manifests say so", () => {
    const installed = executableFootprint({
      checkout: "/srv/lle",
      packageDir: "/srv/lle/node_modules/agent-protocol",
    });
    // `node_modules` is inside the checkout here, and that is still the installed shape —
    // what decides the version is the lockfile, not a source file somebody could edit.
    expect(installed.dirs).toEqual(["node_modules/agent-protocol"]);
    const elsewhere = executableFootprint({ checkout: "/srv/lle", packageDir: "/opt/aco" });
    expect(elsewhere.dirs).toEqual([]);
    expect(elsewhere.means).toContain("pnpm-lock.yaml");
  });

  it("no package dir at all is the installed shape, not an empty footprint", () => {
    const bundled = executableFootprint({ checkout: "/srv/lle" });
    expect(bundled.whole).toBe(false);
    expect(bundled.means).toContain("installed package");
  });

  it("an entry INSIDE the checkout with no boundary around it narrows NOTHING", () => {
    // The dangerous shape: a boundary nobody could measure must not become a narrowing,
    // or a real code change is withheld. Unknown widens the footprint, never shrinks it.
    const unbounded = executableFootprint({ checkout: "/srv/aco", entry: "/srv/aco/src/cli.ts" });
    expect(unbounded.whole).toBe(true);
    expect(executableChange({ footprint: unbounded, changed: ["CARD.md"] }).kind).toBe("changed");
  });

  it("a package root that IS the checkout makes every path of it executable", () => {
    expect(executableFootprint({ checkout: "/srv/aco", packageDir: "/srv/aco" }).whole).toBe(true);
  });
});

describe("executableChange — the measure the narrowing stands on", () => {
  it("a docs-only drift moves NOTHING executable — the field case of the consumer circuit", () => {
    expect(
      executableChange({
        footprint: source,
        changed: ["docs/pin-rollout.md", "docs/pin-rollout-lle.md"],
      }),
    ).toEqual({ kind: "untouched" });
  });

  it("a source file under the package is a change, and it names which", () => {
    const verdict = executableChange({
      footprint: source,
      changed: ["docs/x.md", "packages/agent-protocol/src/cli.ts"],
    });
    expect(verdict.kind).toBe("changed");
    if (verdict.kind === "changed")
      expect(verdict.paths).toEqual(["packages/agent-protocol/src/cli.ts"]);
  });

  it("a lockfile alone is a change of the executable in BOTH shapes — it moves what installs", () => {
    expect(executableChange({ footprint: source, changed: ["pnpm-lock.yaml"] }).kind).toBe(
      "changed",
    );
    const installed = executableFootprint({ checkout: "/srv/lle" });
    expect(executableChange({ footprint: installed, changed: ["pnpm-lock.yaml"] }).kind).toBe(
      "changed",
    );
    // …and a doc of the consumer repository still is not, though nothing of it is executed.
    expect(executableChange({ footprint: installed, changed: ["docs/pin.md"] }).kind).toBe(
      "untouched",
    );
  });

  it("a diff nobody could read is UNMEASURED and never 'nothing changed'", () => {
    const verdict = executableChange({
      footprint: source,
      changed: undefined,
      why: "git would not read",
    });
    expect(verdict.kind).toBe("unmeasured");
  });
});

describe("planSelfRestartDelivery — the narrowing, and what it must not swallow", () => {
  it("WITHHOLDS the letter when the restart moved nothing this daemon runs", () => {
    const plan = planSelfRestartDelivery({
      signature: selfRestartSignature(full),
      event: full,
      footprint: source,
      change: { kind: "untouched" },
    });
    expect(plan.post).toBe(false);
    if (plan.post === false) {
      expect(plan.said).toContain("WITHHELD");
      // The line must let a reader CHECK the narrowing: both shas, and what was measured.
      expect(plan.said).toContain("fd1c14a67121");
      expect(plan.said).toContain("7db145ba901a");
      expect(plan.said).toContain("packages/agent-protocol");
      expect(plan.said).toContain(SELF_RESTART_WAITING_ON);
    }
  });

  it("POSTS when the measure failed — a letter is not silenced by an unreadable diff", () => {
    expect(
      planSelfRestartDelivery({
        signature: selfRestartSignature(full),
        event: full,
        footprint: source,
        change: { kind: "unmeasured", why: "git would not read" },
      }).post,
    ).toBe(true);
  });

  it("says ALREADY POSTED rather than WITHHELD for a letter that went — they are two facts", () => {
    const plan = planSelfRestartDelivery({
      signature: selfRestartSignature(full),
      memo: { signature: selfRestartSignature(full), at: "2026-09-06T17:00:05Z" },
      event: full,
      footprint: source,
      change: { kind: "untouched" },
    });
    expect(plan.post).toBe(false);
    if (plan.post === false) expect(plan.said).toContain("SUPPRESSED");
  });
});

/**
 * THE CADENCE OF A QUIET RUN (thread 180, form (C), `N` = 100 named by curator 2026-09-12).
 *
 * The flood was MEASURED before it was fixed: one rotation of `.orchestrator/daemon.log.1`
 * carried 6933 `SUPPRESSED` lines, 6718 of them byte-identical and all about ONE restart —
 * 3,5 % of the journal of the epoch. What these cases pin is the two halves of the answer:
 * nothing is ever silenced (the first tick of every run says the FULL text) and nothing is
 * repeated more often than every hundredth tick, on BOTH quiet branches.
 */
describe("planSelfRestartDelivery — the cadence of a quiet run", () => {
  const memo: SelfRestartMemo = {
    signature: selfRestartSignature(full),
    at: "2026-09-06T17:00:05Z",
  };

  /** A run of ticks as the daemon does it: the run goes in as an argument and comes back. */
  const runOf = (input: {
    readonly ticks: number;
    readonly memo?: SelfRestartMemo;
    readonly change: ExecutableChange;
    readonly event?: SelfRestartEvent;
    readonly quiet?: SelfRestartQuietRun;
  }): {
    readonly said: readonly (string | undefined)[];
    readonly quiet: SelfRestartQuietRun | undefined;
  } => {
    const event = input.event ?? full;
    let quiet = input.quiet;
    const said: (string | undefined)[] = [];
    for (let tick = 0; tick < input.ticks; tick += 1) {
      const plan = planSelfRestartDelivery({
        signature: selfRestartSignature(event),
        ...(input.memo === undefined ? {} : { memo: input.memo }),
        event,
        footprint: source,
        change: input.change,
        ...(quiet === undefined ? {} : { quiet }),
      });
      if (plan.post) throw new Error("this run is not a quiet one — the case is built wrong");
      said.push(plan.said);
      quiet = plan.quiet;
    }
    return { said, quiet };
  };

  /** Which ticks of a run spoke at all — the shape the whole cadence is asserted through. */
  const spokeOn = (said: readonly (string | undefined)[]): readonly number[] =>
    said.flatMap((line, at) => (line === undefined ? [] : [at]));

  it("SUPPRESSED: the first tick says the FULL text and no tick of a run is ever silent first", () => {
    const { said } = runOf({ ticks: 1, memo, change: changed });
    expect(said[0]).toContain("SUPPRESSED, nothing new to say");
    expect(said[0]).toContain(memo.at as string);
    expect(said[0]).toContain(SELF_RESTART_SLUG);
  });

  it("SUPPRESSED: then it repeats every 100th tick and says NOTHING in between", () => {
    const ticks = 2 * SELF_RESTART_QUIET_CADENCE + 50;
    const { said } = runOf({ ticks, memo, change: changed });
    // 250 ticks, 3 lines — this is the flood of 6933 and its answer, in one assertion.
    expect(spokeOn(said)).toEqual([0, SELF_RESTART_QUIET_CADENCE, 2 * SELF_RESTART_QUIET_CADENCE]);
    expect(said[SELF_RESTART_QUIET_CADENCE]).toContain("SUPPRESSED still");
    // THE REPEAT CARRIES MORE THAN THE LINE IT REPLACES: how long the box has been saying
    // it, in ticks, and the stamp it is counting from — the reader converts one into the
    // other themselves, because the period of the poll is not a fact this module has.
    expect(said[SELF_RESTART_QUIET_CADENCE]).toContain(`${SELF_RESTART_QUIET_CADENCE} tick(s)`);
    expect(said[SELF_RESTART_QUIET_CADENCE]).toContain(memo.at as string);
    expect(said[2 * SELF_RESTART_QUIET_CADENCE]).toContain(
      `${2 * SELF_RESTART_QUIET_CADENCE} tick(s)`,
    );
  });

  it("WITHHELD: the same cadence, because the measured flood is not on one branch alone", () => {
    const ticks = 2 * SELF_RESTART_QUIET_CADENCE + 50;
    const { said } = runOf({ ticks, change: { kind: "untouched" } });
    expect(spokeOn(said)).toEqual([0, SELF_RESTART_QUIET_CADENCE, 2 * SELF_RESTART_QUIET_CADENCE]);
    // The full line still carries both shas and the footprint — the branch stays checkable.
    expect(said[0]).toContain("WITHHELD, the restart changed NOTHING");
    expect(said[0]).toContain("fd1c14a67121");
    expect(said[0]).toContain("packages/agent-protocol");
    const again = said[SELF_RESTART_QUIET_CADENCE];
    expect(again).toContain("WITHHELD still");
    expect(again).toContain(`${SELF_RESTART_QUIET_CADENCE} tick(s)`);
    // The stamp on THIS branch is the event's: no letter ever went, which is the fact said.
    expect(again).toContain(full.at);
  });

  it("a NEW restart starts the cadence over — two restarts are two events", () => {
    const ticks = SELF_RESTART_QUIET_CADENCE + 30;
    const { quiet } = runOf({ ticks, memo, change: changed });
    const second: SelfRestartEvent = { ...full, at: "2026-09-07T05:00:00Z" };
    const { said } = runOf({
      ticks: 1,
      memo: { signature: selfRestartSignature(second), at: "2026-09-07T05:00:09Z" },
      change: changed,
      event: second,
      ...(quiet === undefined ? {} : { quiet }),
    });
    // Without this the second restart would inherit the silence of the first, and the one
    // event this package exists to announce would be announced to nobody.
    expect(said[0]).toContain("SUPPRESSED, nothing new to say");
    expect(said[0]).toContain("2026-09-07T05:00:09Z");
  });

  it("the two quiet branches do not share a run — one is not the continuation of the other", () => {
    const { quiet } = runOf({ ticks: SELF_RESTART_QUIET_CADENCE + 10, memo, change: changed });
    const { said } = runOf({
      ticks: 1,
      change: { kind: "untouched" },
      ...(quiet === undefined ? {} : { quiet }),
    });
    expect(said[0]).toContain("WITHHELD, the restart changed NOTHING");
    expect(said[0]).not.toContain("still");
  });

  it("no memory at all is still the full text — the fail-soft direction does not move", () => {
    // Absent or unreadable, the memo reads as `undefined` (`readSelfRestartMemo`), and a
    // restart that moved code POSTS rather than joining any cadence.
    expect(
      planSelfRestartDelivery({
        signature: selfRestartSignature(full),
        event: full,
        footprint: source,
        change: changed,
      }).post,
    ).toBe(true);
    expect(runOf({ ticks: 1, change: { kind: "untouched" } }).said[0]).toContain(
      "WITHHELD, the restart changed NOTHING",
    );
  });

  /**
   * THE MEMO WITHOUT A STAMP (thread 180, §5 of 2026-09-12, measured by probe rather than
   * read): `readSelfRestartMemo` guards the signature and nothing else, so a truncated or
   * hand-edited file printed `… posted … at undefined …` — into the one line a quiet branch
   * repeats. The absence is NAMED now, in the form this module already had one door down.
   */
  it("a memo with no stamp NAMES the absence and never prints the word 'undefined'", () => {
    const stampless: SelfRestartMemo = { signature: "a1b2c3" };
    const first = describeSuppressedSelfRestartLetter({ memo: stampless });
    const again = describeSuppressedSelfRestartLetterStill({ memo: stampless, ticks: 101 });
    for (const line of [first, again]) {
      expect(line).not.toContain("undefined");
      expect(line).toContain("carries no stamp");
      expect(line).toContain(SELF_RESTART_SLUG);
    }
    expect(again).toContain("100 tick(s)");
  });

  it("the withheld repeat stands on the event alone — it has no letter to point at", () => {
    const again = describeWithheldSelfRestartLetterStill({ event: full, ticks: 201 });
    expect(again).toContain("200 tick(s)");
    expect(again).toContain("7db145ba901a");
    expect(again).not.toContain("undefined");
  });
});

describe("the letter says WHY it was written, now that most restarts get none", () => {
  it("names the footprint paths that moved", () => {
    const { body } = planSelfRestartLetter({ change: changed, event: full, root });
    expect(body).toContain("сдвинулся ли отпечаток установки");
    expect(body).toContain("packages/agent-protocol/src/orchestrator/self-restart.ts");
  });

  /**
   * THE FINDING OF THE CONSUMER CIRCUIT (thread 161, curator 2026-09-09): the criterion is
   * "a path that COULD move the program" and the line reported it as "the executable HAS
   * changed". Their measured case — a lockfile moved by one workspace link in a neighbour's
   * devDeps, `node_modules/agent-protocol` at the same version on both sides — is true by
   * the criterion and false by that sentence, so what this asserts is the CAUTION, not a
   * wording: a letter that states the change as a fact fails here.
   */
  it("does not claim the executable CHANGED — the measure is what could move it", () => {
    const { body } = planSelfRestartLetter({
      change: { kind: "changed", paths: ["pnpm-lock.yaml"] },
      event: full,
      root,
    });
    expect(body).not.toContain("что сменилось в исполняемом");
    expect(body).toContain("МОГЛА сменить программу");
    expect(body).toContain("ДЕЙСТВИТЕЛЬНО другая, здесь не измерено");
  });

  it("says outright that it went on an UNMEASURED restart, and why that is not silence", () => {
    const { body } = planSelfRestartLetter({
      change: { kind: "unmeasured", why: "git would not read" },
      event: full,
      root,
    });
    expect(body).toContain("НЕ ИЗМЕРЕН");
    expect(body).toContain("git would not read");
  });

  it("names the DRAIN — that it waited a live session out and tore none of them", () => {
    const { body } = planSelfRestartLetter({ change: changed, event: full, root });
    expect(body).toContain("ДОЖДАЛСЯ живых сессий");
    expect(body).toContain("ни одна не была порвана");
  });

  it("claims no vigil when none is recorded: a wait it cannot prove is not asserted", () => {
    const { body } = planSelfRestartLetter({
      change: changed,
      event: { to: full.to, at: full.at, repair: "went", wentAt: full.at },
      root,
    });
    expect(body).not.toContain("ДОЖДАЛСЯ живых сессий");
    expect(body).toContain("поднялся на новом коде");
  });
});

describe("the withheld journal line", () => {
  it("says the restart itself STANDS — what is saved is the letter, not the repair", () => {
    const said = describeWithheldSelfRestartLetter({ event: full, footprint: source });
    expect(said).toContain("STANDS");
    expect(said).toContain("NOTHING THIS DAEMON EXECUTES");
  });
});

/**
 * THE SEAM, and it is the one this package is: the facts written by the process that died
 * (#309) reach a letter read by a human. A unit over the mapping does not measure it — what
 * is asserted here is that `selfRestartEvent`'s OUTPUT is what the letter's input consumes,
 * field for field, with no adapter in between.
 */
describe("the seam: the memory that survived the exit → the letter", () => {
  const memory: SelfRestartMemory = {
    target: "7db145ba901a521621eaed0f1fb89a146ebec8c3",
    attempts: 1,
    at: "2026-09-06T17:00:00Z",
    from: "fd1c14a671210777eebd6e36c449986bcded0a30",
    behind: 18,
    drainSince: "2026-09-06T15:49:30Z",
  };

  it("carries all four facts from the file into the body, the wait ARITHMETIC included", () => {
    const event = selfRestartEvent({ memory, loaded: memory.target });
    expect(event).toBeDefined();
    if (event === undefined) return;
    const { body } = planSelfRestartLetter({ change: changed, event, root });
    expect(body).toContain("fd1c14a67121");
    expect(body).toContain("7db145ba901a");
    expect(body).toContain("18 коммит");
    // 15:49:30Z → 17:00:00Z is 4230 seconds, and the letter is what says so.
    expect(body).toContain("1 ч 10 мин (4230 с)");
  });

  it("a file written BEFORE those fields still yields a letter — it just says less", () => {
    const old: SelfRestartMemory = {
      target: memory.target,
      attempts: 1,
      at: memory.at,
    };
    const event = selfRestartEvent({ memory: old, loaded: old.target });
    expect(event).toBeDefined();
    if (event === undefined) return;
    const { body } = planSelfRestartLetter({ change: changed, event, root });
    expect(body).toContain("7db145ba901a");
    expect(body).toContain("не записано");
  });

  it("somebody ELSE's restart yields no event, and so no letter is ever planned", () => {
    expect(selfRestartEvent({ memory, loaded: "0000000000000000000000000000000000000000" })).toBe(
      undefined,
    );
  });

  /**
   * THE FIELD CASE OF THREAD 173, end to end: the record the box actually left on disk on
   * 2026-09-08, through `selfRestartEvent`, into the body a human read. The letter that
   * went said the box "починил своё дерево и поднялся на новом коде", dated the restart
   * `12:30:57Z` and priced the drain at `0 с` — and curator measured all three against
   * `daemon.log` and found no repair in it at all.
   */
  describe("the drain that was interrupted — a matching sha reported as a repair", () => {
    const interrupted: SelfRestartMemory = {
      target: "d3a07723a799c414de9c7275bb4340653cdb7998",
      attempts: 0,
      at: "2026-09-08T12:30:57Z",
      drainSince: "2026-09-08T12:30:57Z",
      from: "5b9795aea4619e3b2ff8de8ca9c8b4ea1e0f2c11",
      behind: 1,
    };
    const event = selfRestartEvent({ memory: interrupted, loaded: interrupted.target });
    const body = (): string => {
      expect(event).toBeDefined();
      return planSelfRestartLetter({
        change: changed,
        event: event as SelfRestartEvent,
        root,
        served: "/home/lle/projects/agent-crew-orchestrator",
      }).body;
    };

    it("never prices the drain at zero — the very cost the letter is written to report", () => {
      expect(body()).not.toContain("сколько ждал сессии:** 0 с");
      expect(body()).toMatch(/сколько ждал сессии:.*не записано/);
    });

    it("does not date the restart by the start of the drain", () => {
      expect(body()).toMatch(/когда пошёл:.*не записано/);
      // The stamp may still appear — as the start of the drain, under that name — and it
      // may never stand alone after "когда пошёл:".
      expect(body()).not.toContain("**когда пошёл:** 2026-09-08T12:30:57Z");
      expect(body()).toContain("НАЧАЛО СЛИВА");
    });

    it("does not report a repair, in the heading or in the opening sentence", () => {
      expect(body()).not.toContain("перезапустил себя");
      expect(body()).not.toContain("без руки");
      expect(body()).not.toContain("починил своё дерево");
      expect(body()).not.toContain("ДОЖДАЛСЯ живых сессий");
      expect(body()).toContain("РЕМОНТА ЗА НИМ НЕ ЗАПИСАНО");
    });

    it("still says what IS known — the shas, the distance and the circuit", () => {
      // The narrowing is of the CLAIM, not of the report: the box is running new code and
      // a silence about that is the failure this whole package exists to prevent.
      expect(body()).toContain("5b9795aea461");
      expect(body()).toContain("d3a07723a799");
      expect(body()).toContain("1 коммит");
      expect(body()).toContain("/home/lle/projects/agent-crew-orchestrator");
    });

    it("gives curator somewhere to look instead of an unanswerable doubt", () => {
      expect(body()).toContain("daemon.log");
      expect(body()).toContain("leaving with code 75");
    });

    it("the SAME record, once the go has written over it, is the ordinary letter again", () => {
      const went = selfRestartEvent({
        memory: { ...interrupted, at: "2026-09-08T12:40:41Z", went: true },
        loaded: interrupted.target,
      });
      expect(went).toBeDefined();
      const said = planSelfRestartLetter({
        change: changed,
        event: went as SelfRestartEvent,
        root,
      }).body;
      expect(said).toContain("ДОЖДАЛСЯ живых сессий");
      expect(said).toContain("9 мин (584 с)");
      expect(said).toContain("**когда пошёл:** 2026-09-08T12:40:41Z");
    });

    it("the journal line of an undelivered letter carries the same caution", () => {
      // It is the ONLY trace of an event nobody was told about — dating it by a drain stamp
      // would reproduce the defect where it is harder still to catch.
      const said = describeUndeliveredSelfRestartLetter({
        event: event as SelfRestartEvent,
        cause: "the delivery exited 1",
      });
      expect(said).not.toContain("since 2026-09-08T12:30:57Z");
      expect(said).toContain("no stamp");
    });
  });
});
