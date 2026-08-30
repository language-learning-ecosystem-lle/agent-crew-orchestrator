import { describe, expect, it } from "vitest";
import { judgeContour, remoteIdentity } from "./contour.js";

const own = {
  ownContour: "hetzner",
  ownRepo: "/home/lle/projects/agent-crew-orchestrator",
  ownRemote: "https://github.com/org/agent-crew-orchestrator.git",
} as const;

describe("remoteIdentity", () => {
  it("reads three spellings of one repository as one identity", () => {
    const https = remoteIdentity("https://github.com/org/repo.git");
    expect(https).toBe("github.com/org/repo");
    expect(remoteIdentity("git@github.com:org/repo")).toBe(https);
    expect(remoteIdentity("ssh://git@github.com:22/org/repo/")).toBe(https);
  });

  it("keeps a local path as its own identity instead of dropping it", () => {
    expect(remoteIdentity("/srv/mirrors/repo.git")).toBe("/srv/mirrors/repo");
  });

  it("answers nothing for a tree with no remote", () => {
    expect(remoteIdentity(undefined)).toBeUndefined();
    expect(remoteIdentity("  ")).toBeUndefined();
  });
});

describe("judgeContour", () => {
  it("passes the contour's own checkout and its role worktrees", () => {
    expect(judgeContour({ ...own, target: own.ownRepo }).verdict).toBe("own");
    expect(judgeContour({ ...own, target: `${own.ownRepo}/.worktrees/dev-core` }).verdict).toBe(
      "own",
    );
  });

  it("passes a checkout elsewhere on the box that is the same repository", () => {
    const verdict = judgeContour({
      ...own,
      target: "/tmp/scratch/aco",
      targetRemote: "git@github.com:org/agent-crew-orchestrator.git",
    });
    expect(verdict.verdict).toBe("own");
  });

  it("refuses a tree of another circuit and names both contours and what to do", () => {
    const verdict = judgeContour({
      ...own,
      target: "/tmp/lle",
      targetContour: "lle-hetzner",
      targetRemote: "https://github.com/org/language-learning-ecosystem.git",
    });
    if (verdict.verdict !== "foreign")
      throw new Error(`expected a refusal, got ${verdict.verdict}`);
    expect(verdict.refusal).toContain("/tmp/lle");
    expect(verdict.refusal).toContain("github.com/org/language-learning-ecosystem");
    expect(verdict.refusal).toContain("lle-hetzner");
    expect(verdict.refusal).toContain("hetzner");
    expect(verdict.refusal).toContain("a role OF that circuit");
  });

  it("refuses a foreign tree this box does not declare at all", () => {
    const verdict = judgeContour({
      ...own,
      target: "/tmp/somebody-elses",
      targetRemote: "https://github.com/other/thing.git",
    });
    expect(verdict.verdict).toBe("foreign");
  });

  it("declares nothing when no instance claims the caller's tree", () => {
    const verdict = judgeContour({
      target: "/tmp/anything",
      targetRemote: "https://github.com/other/thing.git",
    });
    if (verdict.verdict !== "unknown")
      throw new Error(`expected 'unknown', got ${verdict.verdict}`);
    expect(verdict.because).toContain("no instance of this box claims");
  });

  it("says WHY it cannot judge a tree without an origin instead of guessing", () => {
    const verdict = judgeContour({ ...own, target: "/tmp/fresh-init" });
    if (verdict.verdict !== "unknown")
      throw new Error(`expected 'unknown', got ${verdict.verdict}`);
    expect(verdict.because).toContain("declares no 'origin'");
  });
});

/**
 * THE GROUND (thread 062, second half of the same measure). The judge above answers
 * about the TARGET; these two cases are about where the command was typed, and the
 * difference between them is the whole point: an empty box has no boundary, a box
 * with declared contours has one and a caller outside all of them is outside it.
 */
describe("judgeContour — the tree the command came from", () => {
  it("refuses a caller standing in a tree no declared contour claims", () => {
    const verdict = judgeContour({
      target: "/tmp/lle-clone",
      targetRemote: "https://github.com/o/language-learning-ecosystem.git",
      boxContours: ["hetzner", "lle-hetzner"],
    });
    expect(verdict.verdict).toBe("foreign");
    if (verdict.verdict !== "foreign") return;
    expect(verdict.refusal).toContain("no contour of this box");
    expect(verdict.refusal).toContain("'hetzner'");
  });

  it("judges nothing on a box that declares no contour — and says why", () => {
    const verdict = judgeContour({
      target: "/tmp/anywhere",
      targetRemote: "https://github.com/o/anything.git",
      boxContours: [],
    });
    expect(verdict.verdict).toBe("unknown");
  });
});
