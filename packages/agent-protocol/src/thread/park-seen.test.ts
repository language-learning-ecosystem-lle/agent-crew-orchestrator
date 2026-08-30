import { describe, expect, it } from "vitest";
import { judgeParkSeen } from "./park-seen.js";
import type { Parking } from "./thread.js";

const personPark: Parking = {
  kind: "person",
  person: "john",
  holder: "curator",
  since: "2026-08-30T14:24:50Z",
  question: "допустимо ли сузить лифт person-парка",
  asks: true,
};

const runPark: Parking = {
  kind: "run",
  pr: 153,
  since: "2026-08-30T19:18:52Z",
  question: "жду CI по #153",
  asks: false,
};

const eventPark: Parking = {
  kind: "event",
  pr: 127,
  since: "2026-08-30T10:00:00Z",
  question: "жду кнопку по #127",
  asks: false,
};

describe("judgeParkSeen", () => {
  it("says nothing about a thread nobody parked", () => {
    expect(judgeParkSeen({ thread: "058-x", parking: undefined })).toEqual({ ok: true });
  });

  it("refuses the incident letter and names the park, the turn, the question and all three exits", () => {
    const verdict = judgeParkSeen({ thread: "110-speech", parking: personPark });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // The park in full: what it waits for, since when, whose turn it was declared on, and the
    // question in the words it was asked in — a refusal one cannot act on is a defect even
    // when the logic is right.
    expect(verdict.reason).toContain("PARKED behind a decision of john's");
    expect(verdict.reason).toContain("since 2026-08-30T14:24:50Z");
    expect(verdict.reason).toContain("declared on curator's turn");
    expect(verdict.reason).toContain("допустимо ли сузить лифт person-парка");
    expect(verdict.reason).toContain("--delivers john");
    expect(verdict.reason).toContain("--parked-on john");
    expect(verdict.reason).toContain("--park-lifted john");
  });

  it("lets through the letter that CARRIES the word the park waits for", () => {
    expect(judgeParkSeen({ thread: "110-speech", parking: personPark, delivers: "john" })).toEqual({
      ok: true,
    });
  });

  it("lets through the letter that carries the park FORWARD", () => {
    expect(judgeParkSeen({ thread: "110-speech", parking: personPark, parkedOn: "john" })).toEqual({
      ok: true,
    });
  });

  it("lets through the letter that NAMES the lift", () => {
    expect(judgeParkSeen({ thread: "110-speech", parking: personPark, lifted: "john" })).toEqual({
      ok: true,
    });
  });

  it("refuses a --park-lifted naming another park than the standing one", () => {
    const verdict = judgeParkSeen({ thread: "058-x", parking: runPark, lifted: "john" });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("--park-lifted 'john'");
    expect(verdict.reason).toContain("is 'run:153'");
    expect(verdict.reason).toContain("the round running on PR #153");
  });

  it("a park on a person is not addressed by a park on another value being declared", () => {
    const verdict = judgeParkSeen({
      thread: "110-speech",
      parking: personPark,
      parkedOn: "run:153",
    });
    expect(verdict.ok).toBe(false);
  });

  it("a merge announcement addresses the park on that merge, and only on that number", () => {
    expect(judgeParkSeen({ thread: "042-x", parking: eventPark, mergedPr: 127 })).toEqual({
      ok: true,
    });
    expect(judgeParkSeen({ thread: "042-x", parking: eventPark, mergedPr: 128 }).ok).toBe(false);
  });

  it("a verdict addresses the park on the round it is about; a merge of that PR ends it too", () => {
    expect(judgeParkSeen({ thread: "058-x", parking: runPark, verdictPr: 153 })).toEqual({
      ok: true,
    });
    expect(judgeParkSeen({ thread: "058-x", parking: runPark, mergedPr: 153 })).toEqual({
      ok: true,
    });
    expect(judgeParkSeen({ thread: "058-x", parking: runPark, verdictPr: 154 }).ok).toBe(false);
  });

  it("names the exits of a run park in the form its answer is written in", () => {
    const verdict = judgeParkSeen({ thread: "058-x", parking: runPark });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("--verdict <approve|needs-fixes> --pr 153");
    expect(verdict.reason).toContain("--parked-on run:153");
  });

  it("a --park-lifted whose park is already gone is a NOTE, not a refusal — the letter is sent", () => {
    // The subject of thread 058 itself: two roles write into one thread at once, so the park a
    // session read may be lifted by somebody else between the reading and the write.
    const verdict = judgeParkSeen({ thread: "058-x", parking: undefined, lifted: "john" });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.note).toContain("nothing is parked on '058-x' any more");
  });

  it("a park declared with no waiting-on names no turn and still refuses by name", () => {
    const verdict = judgeParkSeen({
      thread: "016-mode",
      parking: {
        kind: "person",
        person: "john",
        since: "2026-08-01T00:00:00Z",
        question: "",
        asks: false,
      },
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).not.toContain("declared on undefined");
    expect(verdict.reason).not.toContain('The question it stands on: ""');
  });
});
