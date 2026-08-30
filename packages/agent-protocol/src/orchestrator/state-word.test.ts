import { describe, expect, it } from "vitest";
import { RELEASE_REASONS } from "./journal.js";
import type { LeaseView } from "./lease.js";
import { stateWord, timeLeftWord } from "./state-word.js";

const view = (over: Partial<LeaseView> = {}): LeaseView => ({
  role: "dev-core",
  thread: "063-state-model-rewrite",
  state: "running",
  attempt: 1,
  ceiling: 3,
  deadline: "2026-08-30T19:52:00Z",
  waitDeadline: null,
  reason: null,
  lastEvent: "lease-acquired",
  overdue: false,
  exhausted: false,
  launchable: false,
  ...over,
});

describe("stateWord — the three alive states are three different sentences", () => {
  // THE FIXTURE PAIR OF THE WHOLE THREAD: today both of these are "the role is working",
  // and the frame used to call the second one `draining` — a word that reads as shutting
  // down about a session doing full-speed work. Two fixtures, two different words.
  it("working before the report and working after it do not share a word", () => {
    const before = stateWord("running");
    const after = stateWord("draining");
    expect(before).not.toBe(after);
    expect(before).toContain("nothing reported yet");
    expect(after).toContain("already reported");
  });

  it("no alive state is called draining anywhere a human reads it", () => {
    for (const state of ["running", "draining", "waiting"] as const) {
      expect(stateWord(state)).not.toContain("draining");
    }
  });

  it("a parked run says it waits for a PERSON — the frame's other waits are for machines", () => {
    expect(stateWord("waiting")).toContain("person");
  });

  it("every alive word says what the role is DOING, not what the machine calls it", () => {
    expect(stateWord("running")).toContain("working");
    expect(stateWord("draining")).toContain("working");
  });
});

describe("stateWord — every ending has its own name", () => {
  // john: "a million statuses, so that everything is called by its own name". The frame
  // used to print the bare enum, and the test that keeps this honest is the one that walks
  // the enum itself: a reason added to `RELEASE_REASONS` without a phrase fails here.
  it("all eleven release reasons are named, and no two share a phrase", () => {
    const words = RELEASE_REASONS.map((reason) => stateWord("released", reason));
    for (const word of words) {
      expect(word).not.toBe("released");
      expect(word).not.toContain("undefined");
    }
    expect(new Set(words).size).toBe(RELEASE_REASONS.length);
  });

  // THE CONFLATION THAT COST THE MOST: to a reader who has not read `journal.ts` these two
  // enums look like one class of thing, and they call for opposite actions — the first is
  // the pair's own break and spends an attempt, the second is the box killing the round.
  it("the pair's own break and the box killing the round read as different things", () => {
    const own = stateWord("released", "exited-without-handoff");
    const box = stateWord("released", "supervisor-gone");
    expect(own).toContain("quit without passing the turn");
    expect(box).toContain("supervisor");
    expect(own).not.toBe(box);
  });

  // `timeout` asks for a wider window, `stalled` asks for an investigation — the split the
  // journal made in thread 016, now visible in the frame instead of only in the enum.
  it("overran and went silent are opposite diagnoses and read as such", () => {
    expect(stateWord("released", "timeout")).toContain("still working");
    expect(stateWord("released", "stalled")).toContain("no traces");
  });

  it("a stop by hand and a daemon standing down are not the same sentence", () => {
    expect(stateWord("stopped", "forced")).toContain("by hand");
    expect(stateWord("stopped", "graceful")).toContain("stood down");
  });

  it("a released lease with no reason on record says exactly that and invents nothing", () => {
    expect(stateWord("released", null)).toBe("released");
  });

  // A digest arrives from a neighbouring box that may run another version. Printing
  // "working" about a state we do not know is the very failure this file exists to end.
  it("an unknown state is returned as it came, not guessed at", () => {
    expect(stateWord("hibernating")).toBe("hibernating");
  });
});

describe("timeLeftWord — how much is left, without subtracting stamps in your head", () => {
  const now = new Date("2026-08-30T19:12:00Z");

  it("a working run says how much of its window is left", () => {
    expect(timeLeftWord(view(), now)).toBe("40m left of its window");
  });

  it("a run working after its report is judged by the same window", () => {
    expect(timeLeftWord(view({ state: "draining" }), now)).toBe("40m left of its window");
  });

  // The clock in force is the one `foldLeases` already judges by: a parked lease is late
  // when nobody answered, not when the work window ran out.
  it("a parked run is measured by the wait's own ceiling and says so", () => {
    const line = timeLeftWord(
      view({ state: "waiting", waitDeadline: "2026-08-30T19:30:00Z" }),
      now,
    );
    expect(line).toBe("18m left of the wait");
  });

  it("past the deadline it says past, not a negative number", () => {
    expect(timeLeftWord(view({ deadline: "2026-08-30T19:00:00Z" }), now)).toBe(
      "12m past the end of its window",
    );
  });

  it("under a minute says so in words — '0m left' reads as 'no time at all'", () => {
    expect(timeLeftWord(view({ deadline: "2026-08-30T19:12:30Z" }), now)).toContain(
      "under a minute",
    );
  });

  // A deadline on a finished run is history: a countdown beside it would be the frame
  // lying in the reader's favour.
  it("a terminal lease gets no countdown at all", () => {
    expect(timeLeftWord(view({ state: "released", reason: "completed" }), now)).toBe("");
    expect(timeLeftWord(view({ state: "stopped", reason: "graceful" }), now)).toBe("");
  });

  it("a pair with no lease yet is silent rather than inventing a clock", () => {
    expect(timeLeftWord(view({ deadline: null }), now)).toBe("");
  });
});
