/**
 * THE RULE «ONE ANSWER IS NOT A VERDICT», asserted from both sides — the pure judge and
 * the reader that feeds it (thread `097-conflict-has-no-signal`, msg-002).
 *
 * The load-bearing case is the one the field case produced and the old code missed: a
 * FIRST `MERGEABLE` that is a stale cache hit. Everything else here exists so the repair
 * cannot be undone by "it asked twice, that is enough" — twice is enough only when the two
 * answers AGREE.
 */
import { describe, expect, it } from "vitest";

import { isMergeable, judgeMergeability, readMergeability } from "./mergeability.js";

describe("judgeMergeability — a verdict is what two consecutive asks agree on", () => {
  it("refuses to read one answer as a verdict, however definite it looks", () => {
    const reading = judgeMergeability(["MERGEABLE"]);
    expect(reading.state).toBe("unsettled");
    expect(reading.detail).toContain("one answer about mergeability is not a verdict");
  });

  it("takes two agreeing answers as the verdict, and says what it heard", () => {
    const reading = judgeMergeability(["MERGEABLE", "MERGEABLE"]);
    expect(reading).toMatchObject({ state: "settled", mergeable: "MERGEABLE" });
    expect(reading.detail).toContain("agreed by two consecutive asks");
    expect(isMergeable(reading)).toBe(true);
  });

  it("takes a conflict the same way — the door of the label needs this one settled too", () => {
    const reading = judgeMergeability(["CONFLICTING", "CONFLICTING"]);
    expect(reading).toMatchObject({ state: "settled", mergeable: "CONFLICTING" });
    expect(isMergeable(reading)).toBe(false);
  });

  it("THE FIELD CASE: a stale MERGEABLE followed by CONFLICTING is not a verdict", () => {
    const reading = judgeMergeability(["MERGEABLE", "CONFLICTING"]);
    expect(reading.state).toBe("unsettled");
    expect(reading.detail).toContain("consecutive answers disagree");
    expect(isMergeable(reading)).toBe(false);
  });

  it("does not settle on UNKNOWN however many times it is repeated", () => {
    const reading = judgeMergeability(["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
    expect(reading.state).toBe("unsettled");
    expect(reading.detail).toContain("has not finished computing the merge");
  });

  it("reads the lazy opening for what it is: UNKNOWN, then two that agree, settles", () => {
    const reading = judgeMergeability(["UNKNOWN", "CONFLICTING", "CONFLICTING"]);
    expect(reading).toMatchObject({ state: "settled", mergeable: "CONFLICTING" });
  });

  it("judges by the LAST two — an old agreement does not survive a newer disagreement", () => {
    const reading = judgeMergeability(["MERGEABLE", "MERGEABLE", "CONFLICTING"]);
    expect(reading.state).toBe("unsettled");
  });

  it("says '(absent)' rather than guessing when gh answered nothing", () => {
    const reading = judgeMergeability([undefined, null]);
    expect(reading.state).toBe("settled");
    expect(reading).toMatchObject({ mergeable: "(absent)" });
    expect(isMergeable(reading)).toBe(false);
  });

  it("normalises case and spacing — the word is the verdict, not its typography", () => {
    expect(judgeMergeability([" mergeable ", "MERGEABLE"])).toMatchObject({
      state: "settled",
      mergeable: "MERGEABLE",
    });
  });

  it("nothing asked at all is unsettled and says so by count", () => {
    expect(judgeMergeability([]).detail).toContain("asked 0 time(s)");
  });
});

describe("readMergeability — asks again itself, and stops as soon as two agree", () => {
  const scripted = (answers: readonly (string | null | undefined)[]) => {
    const pauses: number[] = [];
    let at = 0;
    const reading = readMergeability({
      ask: () => answers[at++],
      pause: (ms) => pauses.push(ms),
      pauseMs: 7,
    });
    return { reading, asked: at, pauses };
  };

  it("never asks fewer than twice, even when the first answer is definite", () => {
    const { reading, asked } = scripted(["MERGEABLE", "MERGEABLE", "CONFLICTING"]);
    expect(asked).toBe(2);
    expect(reading).toMatchObject({ state: "settled", mergeable: "MERGEABLE" });
  });

  it("pauses BETWEEN asks and not before the first — a stale cache needs time, not calls", () => {
    const { pauses } = scripted(["MERGEABLE", "MERGEABLE"]);
    expect(pauses).toEqual([7]);
  });

  it("asks a third time when the first two disagree, and settles on the pair that agrees", () => {
    const { reading, asked, pauses } = scripted(["MERGEABLE", "CONFLICTING", "CONFLICTING"]);
    expect(asked).toBe(3);
    expect(pauses).toEqual([7, 7]);
    expect(reading).toMatchObject({ state: "settled", mergeable: "CONFLICTING" });
  });

  it("gives up after the ceiling and reports the sequence rather than a verdict", () => {
    const { reading, asked } = scripted(["MERGEABLE", "CONFLICTING", "MERGEABLE"]);
    expect(asked).toBe(3);
    expect(reading.state).toBe("unsettled");
    expect(reading.detail).toContain("#1 MERGEABLE, #2 CONFLICTING, #3 MERGEABLE");
  });

  it("holds the floor of two asks even when a caller asks for one", () => {
    let at = 0;
    const answers = ["MERGEABLE", "MERGEABLE"];
    readMergeability({
      ask: () => answers[at++],
      pause: () => {},
      asks: 1,
      pauseMs: 0,
    });
    expect(at).toBe(2);
  });

  it("does not swallow a refusal of gh — the caller's own degradation reads it", () => {
    expect(() =>
      readMergeability({
        ask: () => {
          throw new Error("gh: Resource not accessible by integration");
        },
        pause: () => {},
      }),
    ).toThrow(/not accessible/);
  });
});
