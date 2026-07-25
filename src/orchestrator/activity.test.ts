/**
 * The idle detector (R6, thread 016). What is nailed down here is not "the
 * arithmetic works" but the two decisions that make the difference between a
 * detector and a random killer of live sessions: ANY moving trace means life, and
 * an UNMEASURABLE trace is not evidence of death.
 */
import { describe, expect, it } from "vitest";

import {
  type ActivityTrace,
  DEFAULT_IDLE_MS,
  describeQuiet,
  idleStep,
  startWatch,
  traceChanged,
} from "./activity.js";

const trace = (over: Partial<ActivityTrace> = {}): ActivityTrace => ({
  logBytes: 100,
  worktree: "aaaa",
  cpuMs: 1000,
  ...over,
});

/** A trace where CPU could NOT be measured — no /proc, not "zero CPU". */
const unmeasured = (over: Partial<ActivityTrace> = {}): ActivityTrace => {
  const { cpuMs: _dropped, ...rest } = trace(over);
  return rest;
};

describe("traces of activity", () => {
  it("output grew → alive", () => {
    expect(traceChanged(trace(), trace({ logBytes: 101 }))).toBe(true);
  });

  it("the working tree changed → alive, even in complete silence", () => {
    // A session may edit files for minutes without writing a word to the stream.
    expect(traceChanged(trace(), trace({ worktree: "bbbb" }))).toBe(true);
  });

  it("CPU time grew → alive: a long turn of thinking produces no output at all", () => {
    expect(traceChanged(trace(), trace({ cpuMs: 1010 }))).toBe(true);
  });

  it("nothing moved → no traces", () => {
    expect(traceChanged(trace(), trace())).toBe(false);
  });

  it("an UNMEASURABLE trace is not a change: no /proc must not read as eternal life", () => {
    // Otherwise every poll on a platform without /proc would look like activity and
    // the detector would never fire at all.
    expect(traceChanged(trace(), unmeasured())).toBe(false);
    expect(traceChanged(unmeasured(), trace())).toBe(false);
  });
});

describe("the idle verdict", () => {
  it("silence shorter than the ceiling is not a stall", () => {
    const watch = startWatch(trace(), 0);
    const step = idleStep({ watch, trace: trace(), nowMs: 60_000, idleMs: 600_000 });

    expect(step.stalled).toBe(false);
    expect(step.quietMs).toBe(60_000);
  });

  it("silence past the ceiling → stalled", () => {
    const watch = startWatch(trace(), 0);
    const step = idleStep({ watch, trace: trace(), nowMs: 600_001, idleMs: 600_000 });

    expect(step.stalled).toBe(true);
  });

  it("ANY trace resets the count — a session that woke up is not stuck", () => {
    const watch = startWatch(trace(), 0);
    const alive = idleStep({
      watch,
      trace: trace({ logBytes: 200 }),
      nowMs: 590_000,
      idleMs: 600_000,
    });
    expect(alive.stalled).toBe(false);
    expect(alive.quietMs).toBe(0);

    // ...and the ceiling is counted from THAT moment, not from the launch.
    const later = idleStep({
      watch: alive.watch,
      trace: trace({ logBytes: 200 }),
      nowMs: 1_000_000,
      idleMs: 600_000,
    });
    expect(later.stalled).toBe(false);
  });

  it("the verdict does not depend on the poll interval: rare polls do not stretch the ceiling", () => {
    // The state carries the MOMENT of the last change rather than a count of quiet
    // ticks, so a wrongly set --poll cannot shorten or lengthen the limit.
    const watch = startWatch(trace(), 0);
    const rare = idleStep({ watch, trace: trace(), nowMs: 700_000, idleMs: 600_000 });
    const frequent = idleStep({ watch, trace: trace(), nowMs: 700_000, idleMs: 600_000 });

    expect(rare.stalled).toBe(true);
    expect(frequent.stalled).toBe(true);
  });

  it("idleMs = 0 switches the detector off entirely", () => {
    const watch = startWatch(trace(), 0);
    const step = idleStep({ watch, trace: trace(), nowMs: 10_000_000, idleMs: 0 });

    expect(step.stalled).toBe(false);
  });

  it("the default is ten minutes — the upper end of the guideline, a false stall costs an attempt", () => {
    expect(DEFAULT_IDLE_MS).toBe(600_000);
  });

  it("the silence is named in the release message — a bare 'stalled' explains nothing", () => {
    expect(describeQuiet(605_000)).toBe("no traces of activity for 605s");
  });
});
