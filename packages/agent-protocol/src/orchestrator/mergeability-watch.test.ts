/**
 * THE WATCHMAN'S RULE (thread `097-conflict-has-no-signal`, half 2). The three cases
 * curator asked for by name are the first three blocks below; the rest hold the arithmetic
 * of the second ask and the audible refusal.
 */
import { describe, expect, it } from "vitest";
import {
  asksOwed,
  mergeabilitySaidKey,
  planMergeabilityWatch,
  type WatchedPullRequest,
} from "./mergeability-watch.js";

const pr = (
  number: number,
  samples: readonly (string | null | undefined)[],
  extra: Partial<WatchedPullRequest> = {},
): WatchedPullRequest => ({
  number,
  headSha: `head${number}`,
  thread: `0${number}-a-thread`,
  role: "dev-core",
  samples,
  ...extra,
});

describe("a merge into main voids everybody's mergeability", () => {
  it("says nothing and forgets nothing when every answer is UNKNOWN", () => {
    // The measured tick: `#249` merged, and all seven open pull requests answered
    // `UNKNOWN UNKNOWN` at once — including two that read `MERGEABLE` a minute before.
    const before = planMergeabilityWatch({
      seen: [pr(240, ["CONFLICTING", "CONFLICTING"]), pr(244, ["MERGEABLE", "MERGEABLE"])],
      said: [],
    });
    expect(before.letters.map((letter) => letter.number)).toEqual([240]);
    expect(before.said).toEqual([mergeabilitySaidKey(240)]);

    const after = planMergeabilityWatch({
      seen: [pr(240, ["UNKNOWN", "UNKNOWN"]), pr(244, ["UNKNOWN", "UNKNOWN"])],
      said: before.said,
    });
    expect(after.letters).toEqual([]);
    // The mark survives the void: were it lifted here, the next settled read would
    // announce #240 again, after every merge, forever.
    expect(after.said).toEqual([mergeabilitySaidKey(240)]);
  });
});

describe("exactly one letter per break", () => {
  it("says it once across MERGEABLE → UNKNOWN → CONFLICTING → UNKNOWN → CONFLICTING", () => {
    const ticks: readonly (readonly string[])[] = [
      ["MERGEABLE", "MERGEABLE"],
      ["UNKNOWN", "UNKNOWN"],
      ["CONFLICTING", "CONFLICTING"],
      ["UNKNOWN", "UNKNOWN"],
      ["CONFLICTING", "CONFLICTING"],
    ];
    let said: readonly string[] = [];
    let letters = 0;
    for (const samples of ticks) {
      const plan = planMergeabilityWatch({ seen: [pr(247, samples)], said });
      letters += plan.letters.length;
      said = plan.said;
    }
    expect(letters).toBe(1);
  });

  it("does not count disagreeing asks as a verdict either", () => {
    // `MERGEABLE` then `CONFLICTING` inside one tick is the cache changing its mind, which
    // is the live case that opened this thread — not a break to write home about.
    const plan = planMergeabilityWatch({ seen: [pr(247, ["MERGEABLE", "CONFLICTING"])], said: [] });
    expect(plan.letters).toEqual([]);
    expect(plan.said).toEqual([]);
  });
});

describe("a break that was repaired and came back", () => {
  it("speaks again after a settled MERGEABLE lifted the mark", () => {
    const broke = planMergeabilityWatch({
      seen: [pr(248, ["CONFLICTING", "CONFLICTING"])],
      said: [],
    });
    expect(broke.letters).toHaveLength(1);
    const repaired = planMergeabilityWatch({
      seen: [pr(248, ["MERGEABLE", "MERGEABLE"])],
      said: broke.said,
    });
    expect(repaired.letters).toEqual([]);
    expect(repaired.said).toEqual([]);
    const again = planMergeabilityWatch({
      seen: [pr(248, ["CONFLICTING", "CONFLICTING"])],
      said: repaired.said,
    });
    expect(again.letters.map((letter) => letter.number)).toEqual([248]);
  });
});

describe("the letter", () => {
  it("carries the thread, the author and the whole sequence heard", () => {
    const plan = planMergeabilityWatch({
      seen: [pr(114, ["UNKNOWN", "CONFLICTING", "CONFLICTING"])],
      said: [],
    });
    const letter = plan.letters[0];
    expect(letter?.thread).toBe("0114-a-thread");
    expect(letter?.role).toBe("dev-core");
    expect(letter?.headSha).toBe("head114");
    expect(letter?.detail).toContain("mergeable=CONFLICTING");
    expect(letter?.detail).toContain("#1 UNKNOWN");
  });
});

describe("a mark is not held for a pull request that is gone", () => {
  it("drops the mark of a closed pull request so a reopened break speaks", () => {
    const plan = planMergeabilityWatch({
      seen: [pr(244, ["MERGEABLE", "MERGEABLE"])],
      said: [mergeabilitySaidKey(240), mergeabilitySaidKey(244)],
    });
    expect(plan.said).toEqual([]);
  });
});

describe("the refusal is audible", () => {
  it("names the pull request and what its description is missing, and remembers nothing", () => {
    const plan = planMergeabilityWatch({
      seen: [pr(243, ["CONFLICTING", "CONFLICTING"], { thread: undefined })],
      said: [],
    });
    expect(plan.letters).toEqual([]);
    expect(plan.said).toEqual([]);
    expect(plan.notes.join("\n")).toContain("PR #243");
    expect(plan.notes.join("\n")).toContain("no 'thread:' line");
  });

  it("names both lines when both are missing", () => {
    const plan = planMergeabilityWatch({
      seen: [pr(243, ["CONFLICTING", "CONFLICTING"], { thread: undefined, role: undefined })],
      said: [],
    });
    expect(plan.notes.join("\n")).toContain("neither a 'thread:' nor a 'role:' line");
  });
});

describe("what the second ask is spent on", () => {
  it("asks again only where the free answer disagrees with what is remembered", () => {
    const cheap = [
      { number: 240, mergeable: "CONFLICTING" }, // remembered CONFLICTING — nothing can change
      { number: 244, mergeable: "MERGEABLE" }, // remembered MERGEABLE — nothing can change
      { number: 247, mergeable: "CONFLICTING" }, // remembered MERGEABLE — a break, confirm it
      { number: 248, mergeable: "MERGEABLE" }, // remembered CONFLICTING — a repair, confirm it
    ];
    expect(asksOwed({ cheap, said: [mergeabilitySaidKey(240), mergeabilitySaidKey(248)] })).toEqual(
      [247, 248],
    );
  });

  it("owes an ask for everybody on the tick after a merge, which is the worst case priced", () => {
    const cheap = [240, 244, 247, 248].map((number) => ({ number, mergeable: "UNKNOWN" }));
    expect(asksOwed({ cheap, said: [mergeabilitySaidKey(240)] })).toEqual([240, 244, 247, 248]);
  });

  it("treats an absent word as a disagreement rather than as silence", () => {
    expect(asksOwed({ cheap: [{ number: 244, mergeable: null }], said: [] })).toEqual([244]);
  });
});
