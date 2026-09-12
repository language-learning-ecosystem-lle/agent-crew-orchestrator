import { describe, expect, it } from "vitest";
import {
  COUNTS_AS_STANDSTILL,
  describeStall,
  foldStall,
  parseStall,
  renderStall,
  STALL_TICKS,
  type Stall,
  type StallRefusal,
  stallAlarmDue,
  stallDue,
  stallReasons,
} from "./stall.js";
import { describeSkip, type SkipReason } from "./tick.js";

const at = (minute: number): Date =>
  new Date(`2026-09-09T12:${String(minute).padStart(2, "0")}:00Z`);

/** The first measured standstill, verbatim in shape: one fault, two roles, two sentences. */
const CURATOR_WORKSPACE =
  "the workspace of 'curator' runs 'agent-protocol' 0.2.13, the home checkout '/home/x/aco' runs 0.2.14";
const DEV_CORE_WORKSPACE =
  "the workspace of 'dev-core' runs 'agent-protocol' 0.2.13, the home checkout '/home/x/aco' runs 0.2.14";
/** The second one: the planner itself found nothing launchable. */
const CONFIG_AHEAD =
  "restart required: the repository declares protocol version 27, the package supports only 26";

/**
 * A refusal AS THE DOORS OF THIS PACKAGE MAKE IT: a role, a sentence, and no planner class —
 * which is itself the class, "a door refused a launch the planner had already approved".
 */
const door = (text: string, role: string): StallRefusal => ({ role, text });
/** A refusal as the PLANNER makes it: the same, with the class it refused under. */
const skip = (text: string, role: string, reason: SkipReason): StallRefusal => ({
  role,
  text,
  reason,
});

const tick = (
  previous: Stall | undefined,
  minute: number,
  over: Partial<Parameters<typeof foldStall>[0]> = {},
): Stall | undefined =>
  foldStall({
    previous,
    candidates: 2,
    moving: [],
    refusals: [door(CURATOR_WORKSPACE, "curator"), door(DEV_CORE_WORKSPACE, "dev-core")],
    launching: true,
    now: at(minute),
    ...over,
  });

describe("the run of ticks that raised nobody", () => {
  it("counts consecutive unlifted ticks as ONE stall", () => {
    let stall = tick(undefined, 1);
    stall = tick(stall, 2);
    stall = tick(stall, 3);
    expect(stall).toMatchObject({
      ticks: 3,
      candidates: 2,
      since: "2026-09-09T12:01:00Z",
      last: "2026-09-09T12:03:00Z",
    });
  });

  it("folds two roles refused by ONE cause into one reason: the names differ, the fault does not", () => {
    expect(stallReasons([CURATOR_WORKSPACE, DEV_CORE_WORKSPACE])).toEqual([
      "the workspace of '…' runs '…' 0.2.13, the home checkout '…' runs 0.2.14",
    ]);
  });

  it("keeps the version numbers: 0.2.13 → 0.2.14 is a DIFFERENT fault", () => {
    const [older] = stallReasons([CURATOR_WORKSPACE]);
    const [newer] = stallReasons([CURATOR_WORKSPACE.replace("0.2.13", "0.2.15")]);
    expect(older).not.toBe(newer);
  });

  it("ends the run when every refused role is itself in flight", () => {
    const stall = tick(undefined, 1);
    expect(tick(stall, 2, { moving: ["curator", "dev-core"], candidates: 3 })).toBeUndefined();
  });

  it("does NOT count a queue refused because the roles are busy: that circuit is moving", () => {
    expect(
      foldStall({
        previous: undefined,
        candidates: 14,
        moving: ["dev-core"],
        refusals: [
          skip("dev-core/x — skipped: the pair is running right now", "dev-core", "active"),
        ],
        launching: true,
        now: at(1),
      }),
    ).toBeUndefined();
  });

  /**
   * CURATOR'S SECOND CASE OF ACCEPTANCE (§4 of 2026-09-09, this thread), verbatim: "a box with
   * two roles, one busy for an hour, the other refused by the same refusal every tick — is
   * obliged to ring, and today it is silent". It was silent because one session in flight
   * cleared the run of the WHOLE box; the cover is per role now, and a session of `curator` is
   * no evidence at all about `dev-core`.
   */
  it("RINGS while one role works and the other is refused at the door every tick", () => {
    let stall: Stall | undefined;
    for (const minute of [1, 2, 3])
      stall = foldStall({
        previous: stall,
        candidates: 4,
        moving: ["curator"],
        refusals: [door(DEV_CORE_WORKSPACE, "dev-core")],
        launching: true,
        now: at(minute),
      });
    expect(stall).toMatchObject({ ticks: 3, since: "2026-09-09T12:01:00Z" });
    expect(stallAlarmDue(stall as Stall)).toBe(true);
  });

  it("but a SECOND pair of the role that is working is covered by it: the cover is a role", () => {
    const stall = tick(undefined, 1);
    expect(
      foldStall({
        previous: stall,
        candidates: 4,
        moving: ["curator"],
        refusals: [door(CURATOR_WORKSPACE, "curator")],
        launching: true,
        now: at(2),
      }),
    ).toBeUndefined();
  });

  /**
   * AND THE FINGERPRINT IS OF THE EVIDENCE ONLY. A parked pair entering the queue beside a
   * standstill is not a change of fault; if it entered the key it would restart the run, and
   * the alarm would go silent on exactly the box whose queue moves around a standstill.
   */
  it("keeps a declared wait out of the fingerprint instead of restarting the run with it", () => {
    const first = tick(undefined, 1);
    const second = tick(first, 2, {
      candidates: 3,
      refusals: [
        door(CURATOR_WORKSPACE, "curator"),
        door(DEV_CORE_WORKSPACE, "dev-core"),
        skip("candidate pilot×191 skipped: the turn is parked", "pilot", "parked"),
      ],
    });
    expect(second).toMatchObject({ ticks: 2, since: "2026-09-09T12:01:00Z" });
  });

  it("HOLDS the run through a tick with no candidates: a lull is no evidence either way", () => {
    const stall = tick(tick(undefined, 1), 2);
    const quiet = foldStall({
      previous: stall,
      candidates: 0,
      moving: [],
      refusals: [],
      launching: true,
      now: at(3),
    });
    expect(quiet).toMatchObject({ ticks: 2, since: "2026-09-09T12:01:00Z" });
    expect(tick(quiet, 4)).toMatchObject({ ticks: 3, since: "2026-09-09T12:01:00Z" });
  });

  it("HOLDS the run through a tick that withheld on purpose — a drain is not a standstill", () => {
    const stall = tick(undefined, 1);
    expect(tick(stall, 2, { launching: false })).toBe(stall);
  });

  it("starts a NEW run when the reasons change: a different fault is a different event", () => {
    const first = tick(tick(undefined, 1), 2);
    const second = foldStall({
      previous: first,
      candidates: 8,
      moving: [],
      refusals: [door(CONFIG_AHEAD, "dev-core")],
      launching: true,
      now: at(3),
    });
    expect(second).toMatchObject({ ticks: 1, since: "2026-09-09T12:03:00Z", candidates: 8 });
  });

  /**
   * FINDING 9.1 (curator, 2026-09-12, this thread): the fold used to compare the fingerprint
   * POSITIONALLY, and the fingerprint is built in the order of the refusals — which is the
   * order of the candidates in the plan of the tick, and that order moves with priority, with
   * the age of a turn and with the composition of the queue. Same two causes, other order:
   * the run reset to 1 on every tick, `STALL_TICKS` was never reached and the alarm was silent
   * on precisely the standstill it counts.
   */
  it("keeps the run when the SAME two causes arrive in another order: the key is a set", () => {
    const first = foldStall({
      previous: undefined,
      candidates: 2,
      moving: [],
      refusals: [door(CURATOR_WORKSPACE, "curator"), door(CONFIG_AHEAD, "dev-core")],
      launching: true,
      now: at(1),
    });
    const second = foldStall({
      previous: first,
      candidates: 2,
      moving: [],
      refusals: [door(CONFIG_AHEAD, "dev-core"), door(DEV_CORE_WORKSPACE, "dev-core")],
      launching: true,
      now: at(2),
    });
    expect(second).toMatchObject({ ticks: 2, since: "2026-09-09T12:01:00Z" });
  });

  it("reaches the threshold on a run whose order is shuffled every tick", () => {
    const both = [door(CURATOR_WORKSPACE, "curator"), door(CONFIG_AHEAD, "dev-core")] as const;
    let stall: Stall | undefined;
    for (const minute of [1, 2, 3])
      stall = foldStall({
        previous: stall,
        candidates: 2,
        moving: [],
        refusals: minute % 2 === 0 ? [...both].reverse() : [...both],
        launching: true,
        now: at(minute),
      });
    expect(stall).toMatchObject({ ticks: 3 });
    expect(stallAlarmDue(stall as Stall)).toBe(true);
  });

  it("a set that GREW is still a different fault, however the entries are ordered", () => {
    const first = foldStall({
      previous: undefined,
      candidates: 2,
      moving: [],
      refusals: [door(CURATOR_WORKSPACE, "curator")],
      launching: true,
      now: at(1),
    });
    const second = foldStall({
      previous: first,
      candidates: 2,
      moving: [],
      refusals: [door(CONFIG_AHEAD, "dev-core"), door(CURATOR_WORKSPACE, "curator")],
      launching: true,
      now: at(2),
    });
    expect(second).toMatchObject({ ticks: 1, since: "2026-09-09T12:02:00Z" });
  });

  /**
   * A state file is written by this module but read from disk, so `previous` can carry a
   * repeat nothing here produced. `[a, a]` and `[a, b]` have the same LENGTH and must not
   * read as one fault — which is why the comparison sizes both sides as sets.
   */
  it("a repeated entry in the file on disk does not make two faults read as one", () => {
    const previous: Stall = {
      reasons: [
        stallReasons([CURATOR_WORKSPACE])[0] as string,
        stallReasons([CURATOR_WORKSPACE])[0] as string,
      ],
      since: "2026-09-09T12:00:00Z",
      ticks: 2,
      candidates: 2,
      last: "2026-09-09T12:00:00Z",
    };
    const next = foldStall({
      previous,
      candidates: 2,
      moving: [],
      refusals: [door(CURATOR_WORKSPACE, "curator"), door(CONFIG_AHEAD, "dev-core")],
      launching: true,
      now: at(3),
    });
    expect(next).toMatchObject({ ticks: 1, since: "2026-09-09T12:03:00Z" });
  });

  it("records a tick that refused without saying why, rather than dropping it", () => {
    const stall = foldStall({
      previous: undefined,
      candidates: 4,
      moving: [],
      refusals: [],
      launching: true,
      now: at(1),
    });
    expect(stall).toMatchObject({ ticks: 1, reasons: [] });
    expect(describeStall(stall as Stall)).toContain("no reason was given");
  });
});

describe("the predicate that rings", () => {
  it("stays quiet below the threshold and rings at it", () => {
    let stall = tick(undefined, 1);
    for (let minute = 2; minute < 1 + STALL_TICKS; minute += 1) {
      expect(stallAlarmDue(stall as Stall)).toBe(false);
      stall = tick(stall, minute);
    }
    expect(stallAlarmDue(stall as Stall)).toBe(true);
  });

  it("takes the threshold as an argument, so a second reader can be stricter", () => {
    const stall = tick(tick(undefined, 1), 2) as Stall;
    expect(stallDue(stall, 2)).toBe(true);
    expect(stallDue(stall, 9)).toBe(false);
  });
});

describe("the state as a file", () => {
  it("survives a round trip", () => {
    const stall = tick(tick(undefined, 1), 2) as Stall;
    expect(parseStall(renderStall(stall))).toEqual(stall);
  });

  it("reads a missing, empty or corrupt file as NO stall instead of throwing", () => {
    expect(renderStall(undefined)).toBe("");
    expect(parseStall("")).toBeUndefined();
    expect(parseStall("{")).toBeUndefined();
    expect(parseStall('{"ticks":3}')).toBeUndefined();
    expect(
      parseStall('{"reasons":[1],"since":"x","last":"x","ticks":1,"candidates":1}'),
    ).toBeUndefined();
  });
});

describe("the line the operator reads", () => {
  it("names the count, the threshold, the queue and the cause", () => {
    const stall = tick(tick(tick(undefined, 1), 2), 3) as Stall;
    const line = describeStall(stall);
    expect(line).toContain("3 tick(s) in a row");
    expect(line).toContain(`rings at ${STALL_TICKS}`);
    expect(line).toContain("2 candidate(s) waiting");
    expect(line).toContain("the home checkout");
    expect(line).toContain("since 2026-09-09T12:01:00Z");
  });
});

/**
 * THE SEAM, NOT THE MAPPING (finding 9.2, curator 2026-09-12, this thread). The fingerprint
 * is fed from TWO sources — the doors' refusals and the planner's own skip lines — and the
 * second of them is composed by `describeSkip` of `tick.ts`. The normalisation of this module
 * collapses the QUOTED parts of a refusal, because that is where this package puts what
 * differs between two candidates of one fault; `describeSkip` did not quote the pair, so two
 * roles refused by ONE cause arrived as TWO entries of the set, and at the cap of `REASONS`
 * the set filled up with pair names instead of faults. A unit on either side proves nothing
 * about that: the fold is right and the line is legible, and the seam is still broken. So the
 * lines are composed here by the real function and normalised by the real one.
 */
describe("the planner's own skip lines, through the fingerprint", () => {
  const ceiling = { value: 3, source: "default" } as const;
  const line = (skip: Parameters<typeof describeSkip>[0]): string => describeSkip(skip, ceiling);

  it("two roles HELD by one cause fold to ONE reason", () => {
    const reasons = stallReasons([
      line({ role: "curator", thread: "172-merge-gate", reason: "held", attempt: 0 }),
      line({ role: "dev-core", thread: "081-research", reason: "held", attempt: 0 }),
    ]);
    expect(reasons).toHaveLength(1);
  });

  it("two pairs PARKED on one person fold to ONE reason", () => {
    const reasons = stallReasons([
      line({
        role: "curator",
        thread: "172-merge-gate",
        reason: "parked",
        attempt: 0,
        parkedOn: "john",
      }),
      line({
        role: "dev-core",
        thread: "081-research",
        reason: "parked",
        attempt: 0,
        parkedOn: "john",
      }),
    ]);
    expect(reasons).toHaveLength(1);
  });

  it("two pairs running RIGHT NOW, and two WAITING, fold to one reason each", () => {
    for (const reason of ["active", "waiting"] as const) {
      const reasons = stallReasons([
        line({ role: "curator", thread: "172-merge-gate", reason, attempt: 0 }),
        line({ role: "dev-core", thread: "081-research", reason, attempt: 0 }),
      ]);
      expect(reasons).toHaveLength(1);
    }
  });

  /**
   * THE CEILING, MEASURED RATHER THAN ASSUMED (thread 180, curator's msg of 2026-09-12 §2 and
   * the probe that corrected it, run on `main` `95ba16984`). Two frozen pairs used to fold to
   * ONE class when their attempt counts happened to agree and to TWO when they did not — the
   * pair and the `thaw` command collapse by themselves (the command is a quoted string, so the
   * role and the thread inside it go with it), and the count was the one thing left telling
   * two candidates of ONE ceiling apart. The outcome of that is two tests below, and the
   * second is the one the whole alarm hangs on.
   */
  const frozen = (role: string, thread: string, attempt: number): string =>
    line({ role, thread, reason: "exhausted", attempt });

  it("two pairs frozen by ONE ceiling fold to one reason — even on different attempt counts", () => {
    expect(
      stallReasons([frozen("curator", "172-merge-gate", 3), frozen("dev-core", "081-research", 7)]),
    ).toHaveLength(1);
  });

  it("MORE frozen pairs than the cap of reasons, in a different order each tick → the run still grows", () => {
    // The field shape of a frozen circuit: every pair is at the ceiling, and the order they
    // arrive in is the order of the plan, which is not a constant between ticks. Before the
    // count was quoted this made SIX classes, the cap kept a different five each time, and
    // `ticks` reset to 1 for ever — the alarm of this thread could never ring on the very
    // standstill it exists for.
    const pairs: readonly [string, number][] = [
      ["172-a", 3],
      ["173-b", 4],
      ["174-c", 5],
      ["175-d", 6],
      ["176-e", 7],
      ["177-f", 8],
    ];
    const said = pairs.map(([thread, attempt], index) => frozen(`role-${index}`, thread, attempt));
    expect(stallReasons(said)).toHaveLength(1);

    // THE RUN IS GROWN ON DOORS AND NOT ON THESE LINES since the narrowing of §4.2: a frozen
    // pair is a declared wait and never counts (the case below measures that). What is under
    // test here is the CAP and the ORDER, and it is measured on six refusals of the class that
    // does count — six roles refused at the workspace door, shuffled tick to tick.
    const refusals = pairs.map(([, attempt], index) =>
      door(CURATOR_WORKSPACE.replace("curator", `role-${index}-${attempt}`), `role-${index}`),
    );
    expect(stallReasons(refusals.map((refusal) => refusal.text))).toHaveLength(1);

    const first = foldStall({
      previous: undefined,
      candidates: refusals.length,
      moving: [],
      refusals,
      launching: true,
      now: at(1),
    });
    const second = foldStall({
      previous: first,
      candidates: refusals.length,
      moving: [],
      refusals: [...refusals].reverse(),
      launching: true,
      now: at(2),
    });
    const third = foldStall({
      previous: second,
      candidates: refusals.length,
      moving: [],
      refusals,
      launching: true,
      now: at(3),
    });
    expect(third).toMatchObject({ ticks: 3 });
    expect(third !== undefined && stallAlarmDue(third)).toBe(true);
  });

  /**
   * CURATOR'S FIRST DUTY OF ACCEPTANCE (§4 of 2026-09-09): a refusal that is legitimately long
   * must not ring — not once and not for ever. Six pairs at the attempt ceiling, ten ticks,
   * nothing in flight: the counter never starts a run at all, so there is nothing to ring and
   * `stall.json` stays empty. `exhausted` is the class that has a bell and a standing count of
   * its own (thread 013), and counting it here would ring twice about one fact.
   */
  it("a queue frozen at the attempt ceiling NEVER starts a run, however many ticks pass", () => {
    let stall: Stall | undefined;
    for (let minute = 1; minute <= 10; minute += 1)
      stall = foldStall({
        previous: stall,
        candidates: 2,
        moving: [],
        refusals: [
          skip(frozen("curator", "172-merge-gate", 3), "curator", "exhausted"),
          skip(frozen("dev-core", "081-research", 7), "dev-core", "exhausted"),
        ],
        launching: true,
        now: at(minute),
      });
    expect(stall).toBeUndefined();
  });

  /**
   * AND EVERY OTHER CLASS THE PLANNER HAS, one by one and by its REAL line — the table of
   * {@link COUNTS_AS_STANDSTILL} named them, and this is the case that holds the table to the
   * planner's own union instead of to a copy of it. A class that ever needs to count is added
   * there and falls out of this list; a class nobody has classified does not compile.
   */
  it("no class of the planner's own refusals starts a run on its own", () => {
    for (const reason of Object.keys(COUNTS_AS_STANDSTILL) as readonly SkipReason[]) {
      const said = line({ role: "curator", thread: "172-merge-gate", reason, attempt: 1 });
      expect(
        foldStall({
          previous: undefined,
          candidates: 2,
          moving: [],
          refusals: [skip(said, "curator", reason)],
          launching: true,
          now: at(1),
        }),
      ).toBeUndefined();
    }
  });

  it("and the line still carries the count and the move that ends the freeze", () => {
    // The collapse is of the FINGERPRINT, never of the letter: john's second requirement is
    // that the alarm names the cause AND the repair, and both live in this one line.
    const said = frozen("curator", "172-merge-gate", 7);
    expect(said).toContain("7");
    expect(said).toContain("orchestrator thaw --role curator --thread 172-merge-gate");
  });

  it("and two GENUINELY different causes stay two: the collapse is of names, not of faults", () => {
    const reasons = stallReasons([
      line({ role: "curator", thread: "172-merge-gate", reason: "held", attempt: 0 }),
      line({ role: "dev-core", thread: "081-research", reason: "active", attempt: 0 }),
    ]);
    expect(reasons).toHaveLength(2);
  });

  it("a park on ANOTHER person is another fault — the person is the cause, and it is kept", () => {
    const reasons = stallReasons([
      line({
        role: "curator",
        thread: "172-merge-gate",
        reason: "parked",
        attempt: 0,
        parkedOn: "john",
      }),
      line({
        role: "dev-core",
        thread: "081-research",
        reason: "parked",
        attempt: 0,
        parkedOn: "maysway",
      }),
    ]);
    expect(reasons).toHaveLength(2);
  });
});
