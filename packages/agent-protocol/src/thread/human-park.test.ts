/**
 * The door that refuses a park declared on a person who is asked nothing (thread 050).
 *
 * The assertions bite into the TEXT rather than the return value: the refusal has to leave the
 * role able to repair the header, and the three exits it names are three DIFFERENT statements —
 * ask him something, park behind the event, or hand the turn on. The fourth line of the refusal
 * is the one the statement of work asked for by name: a pause with no form is a defect of the
 * mechanism to be named, not a human to be substituted.
 */
import { describe, expect, it } from "vitest";
import { judgeHumanPark } from "./human-park.js";

describe("judgeHumanPark — a park on a person is a call, and a call needs something to answer", () => {
  it("REFUSES 'parked-on: <person>' + 'expects: none', and names every exit", () => {
    // The shape john read ten of at once on 2026-08-29 — `035` (waiting for the first real round
    // of review) and `045` (waiting for a day of field in another thread) both stood on him and
    // wanted nothing from him.
    const verdict = judgeHumanPark({ parkedOn: "john", expects: "none" });

    expect(verdict.ok).toBe(false);
    const reason = verdict.ok ? "" : verdict.reason;
    expect(reason).toContain("john");
    expect(reason).toContain("--expects answer");
    expect(reason).toContain("--parked-on pr:<number>");
    expect(reason).toContain("--waiting-on <role>");
    // The missing form is named as a defect rather than left to be papered over again.
    expect(reason).toContain("MISSING FORM");
  });

  it("passes 'parked-on: <person>' when something IS wanted of him — answer and ack alike", () => {
    // The lawful park: a decision, a word or an action is required of the human, and `expects`
    // says so in the writer's own hand. `ack` asks for an acknowledgement, which is an action.
    for (const expects of ["answer", "ack"] as const) {
      expect(judgeHumanPark({ parkedOn: "john", expects })).toEqual({ ok: true });
    }
  });

  it("passes BOTH event parks with 'expects: none' — they call nobody by construction", () => {
    // The everyday shape of "handed the turn over and parked behind the round" must not learn a
    // word from this door: `pr:` waits for the button, `run:` waits for the verdict, and neither
    // is anybody's decision (threads 019, 023).
    for (const parkedOn of ["pr:127", "run:163"]) {
      expect(judgeHumanPark({ parkedOn, expects: "none" })).toEqual({ ok: true });
    }
  });

  it("does not judge a header with no park at all", () => {
    // `expects: none` on its own is the informational message of a working thread, and this door
    // has no opinion about it whatever.
    expect(judgeHumanPark({ expects: "none" })).toEqual({ ok: true });
    expect(judgeHumanPark({ parkedOn: undefined, expects: "none" })).toEqual({ ok: true });
  });
});
