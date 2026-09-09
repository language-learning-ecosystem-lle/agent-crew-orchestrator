import { describe, expect, it } from "vitest";
import {
  describeStall,
  foldStall,
  parseStall,
  renderStall,
  STALL_TICKS,
  type Stall,
  stallAlarmDue,
  stallDue,
  stallReasons,
} from "./stall.js";

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

const tick = (
  previous: Stall | undefined,
  minute: number,
  over: Partial<Parameters<typeof foldStall>[0]> = {},
): Stall | undefined =>
  foldStall({
    previous,
    candidates: 2,
    moving: 0,
    refusals: [CURATOR_WORKSPACE, DEV_CORE_WORKSPACE],
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

  it("ends the run the moment anything is in flight, even if the tick also refused one", () => {
    const stall = tick(undefined, 1);
    expect(tick(stall, 2, { moving: 1, candidates: 3 })).toBeUndefined();
  });

  it("does NOT count a queue refused because the roles are busy: that circuit is moving", () => {
    expect(
      foldStall({
        previous: undefined,
        candidates: 14,
        moving: 2,
        refusals: ["dev-core/x — skipped: the role is running"],
        launching: true,
        now: at(1),
      }),
    ).toBeUndefined();
  });

  it("HOLDS the run through a tick with no candidates: a lull is no evidence either way", () => {
    const stall = tick(tick(undefined, 1), 2);
    const quiet = foldStall({
      previous: stall,
      candidates: 0,
      moving: 0,
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
      moving: 0,
      refusals: [CONFIG_AHEAD],
      launching: true,
      now: at(3),
    });
    expect(second).toMatchObject({ ticks: 1, since: "2026-09-09T12:03:00Z", candidates: 8 });
  });

  it("records a tick that refused without saying why, rather than dropping it", () => {
    const stall = foldStall({
      previous: undefined,
      candidates: 4,
      moving: 0,
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
