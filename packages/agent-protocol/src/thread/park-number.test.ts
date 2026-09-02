import { describe, expect, it } from "vitest";
import { judgeParkNumber, MAX_PR_NUMBER } from "./park-number.js";

describe("the number of an event park (thread 061, msg-002)", () => {
  it("lets an ordinary PR number through in both forms", () => {
    expect(judgeParkNumber({ kind: "pr", value: 160 }).ok).toBe(true);
    expect(judgeParkNumber({ kind: "run", value: 160 }).ok).toBe(true);
    // The line is not near anything real: six digits is still a legal PR number.
    expect(judgeParkNumber({ kind: "pr", value: MAX_PR_NUMBER - 1 }).ok).toBe(true);
  });

  // THE LIVE CASE of 2026-08-30, 18:34:38Z: `run:33328290131` — an id of a workflow run where
  // the form wants the number of a PR. The door took it, and the role spent a whole letter
  // undoing the record.
  it("refuses an id of a workflow run and says BOTH halves: what it read, and what it wants", () => {
    const verdict = judgeParkNumber({ kind: "run", value: 33328290131 });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // Half one — what the door took the number for, quoted as typed.
    expect(verdict.reason).toContain("run:33328290131");
    expect(verdict.reason).toContain("NUMBER OF A PULL REQUEST");
    // Half two — the likely cause, named as the hypothesis it is, plus where to read the number.
    expect(verdict.reason).toContain("ID OF A WORKFLOW RUN");
    expect(verdict.reason).toContain("gh pr view --json number");
  });

  it("refuses the same number in the pr: form, naming that form", () => {
    const verdict = judgeParkNumber({ kind: "pr", value: 33328290131 });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("pr:33328290131");
    expect(verdict.reason).toContain("ID OF A WORKFLOW RUN");
  });

  // A number too big to be a PR but too short to accuse of being a run id: the door still
  // refuses (it cannot be a PR anywhere) but does not guess at a cause it cannot know.
  it("refuses a number above the ceiling without inventing a diagnosis", () => {
    const verdict = judgeParkNumber({ kind: "pr", value: 5_000_000 });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("do not reach 1000000");
    expect(verdict.reason).not.toContain("ID OF A WORKFLOW RUN");
  });

  it("refuses zero and negative numbers, because pull requests are numbered from 1", () => {
    for (const value of [0, -1]) {
      const verdict = judgeParkNumber({ kind: "run", value });
      expect(verdict.ok).toBe(false);
      if (verdict.ok) continue;
      expect(verdict.reason).toContain("numbered from 1");
    }
  });
});
