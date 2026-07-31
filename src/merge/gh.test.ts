/**
 * THE READING OF A REFUSAL. Every case here is a message `gh` actually returned during
 * thread 026 — the point of the file is that the hint used to answer "`checks: read`" to
 * all of them, and was right about at most one.
 */
import { describe, expect, it } from "vitest";
import { ghRefusalHint } from "./gh.js";

/** What `execFileSync` hands up: the ECHOED COMMAND LINE, then what the process said. */
const asThrown = (stderr: string): string =>
  [
    "Command failed: gh pr view 112 --json number,headRefOid,body,statusCheckRollup,reviews,files,mergeable,mergeStateStatus",
    stderr,
  ].join("\n");

describe("ghRefusalHint", () => {
  it("says nothing about a scope when the refusal is not about one (the 404 of a wrong account)", () => {
    // The refusal that broke six of curator's calls in one round: the active `gh` account
    // had no access to the repository at all. The old test matched `statusCheckRollup` in
    // the command line above and called this a missing scope.
    expect(
      ghRefusalHint(asThrown("GraphQL: Could not resolve to a Repository with the name 'x/y'.")),
    ).toBe("");
  });

  it("is silent on any other failure too — a hint is not a decoration", () => {
    expect(ghRefusalHint(asThrown("gh: command not found"))).toBe("");
    expect(ghRefusalHint(asThrown("HTTP 502: Bad gateway"))).toBe("");
  });

  it("reads the path GitHub named — `checkSuite.workflowRun` is ACTIONS, not checks", () => {
    // The measured one (#108/#109/#112): `checks: read` WAS granted, and the note that
    // asserted it sent three rounds of diagnosis the wrong way.
    const hint = ghRefusalHint(
      asThrown(
        "GraphQL: Resource not accessible by integration (repository.pullRequest.statusCheckRollup.nodes.0.commit.statusCheckRollup.contexts.nodes.0.checkSuite.workflowRun)",
      ),
    );
    expect(hint).toContain("actions: read");
    expect(hint).not.toContain("checks: read");
    expect(hint).toContain("checkSuite.workflowRun");
  });

  it("reads a Checks path as Checks", () => {
    const hint = ghRefusalHint(
      asThrown(
        "GraphQL: Resource not accessible by integration (repository.pullRequest.statusCheckRollup.nodes.0.commit.statusCheckRollup)",
      ),
    );
    expect(hint).toContain("checks: read");
    expect(hint).not.toContain("actions: read");
  });

  it("offers both candidates when the refusal names no path to decide by", () => {
    const hint = ghRefusalHint(asThrown("GraphQL: Resource not accessible by integration"));
    expect(hint).toContain("checks: read");
    expect(hint).toContain("actions: read");
    expect(hint).toContain("the path it refused");
  });

  it("never states the cause — the scope is offered as a guess in every shape", () => {
    for (const stderr of [
      "GraphQL: Resource not accessible by integration (a.b.checkSuite.workflowRun)",
      "GraphQL: Resource not accessible by integration (a.b.statusCheckRollup)",
      "GraphQL: Resource not accessible by integration",
    ]) {
      expect(ghRefusalHint(asThrown(stderr))).toContain("A guess and not the cause");
    }
  });
});
