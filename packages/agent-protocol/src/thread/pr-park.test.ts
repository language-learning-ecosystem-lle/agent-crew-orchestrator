import { describe, expect, it } from "vitest";

import { describePrPark } from "./pr-park.js";

describe("the door of a park on a merge (thread 030, Д-3)", () => {
  it("names the ONE thing that lifts it — the header, not the state of the PR", () => {
    const note = describePrPark(366);

    expect(note).toContain("'merged-pr: 366'");
    // The half a parker cannot infer from the form and read wrong live: the vendor is not
    // watched, so a merge pressed in GitHub and reported in prose leaves the thread frozen.
    expect(note).toContain("NOTHING WATCHES THE STATE OF #366");
    expect(note).toContain("prose");
  });

  it("carries the number it was asked about, not the one from the case behind it", () => {
    expect(describePrPark(12)).toContain("PR #12");
    expect(describePrPark(12)).not.toContain("#366 ");
  });
});
