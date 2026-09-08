/**
 * THE READING OF A REFUSAL. Every case here is a message `gh` actually returned during
 * thread 026 — the point of the file is that the hint used to answer "`checks: read`" to
 * all of them, and was right about at most one.
 */
import { describe, expect, it } from "vitest";
import {
  forbiddenChecksRollup,
  ghPullRequestSchema,
  ghRefusalHint,
  pullRequestFacts,
} from "./gh.js";

/** What `execFileSync` hands up: the ECHOED COMMAND LINE, then what the process said. */
const asThrown = (stderr: string): string =>
  [
    "Command failed: gh pr view 112 --json number,headRefOid,body,statusCheckRollup,reviews,files,mergeable,mergeStateStatus",
    stderr,
  ].join("\n");

/**
 * THE OTHER WORDING OF THE SAME REFUSAL (thread 172) — and the reason the repair of thread
 * 160 shipped, reached the consumer and changed nothing at all.
 *
 * GitHub names THE ACTOR it refused: an installation token is refused `by integration`,
 * a fine-grained personal token `by personal access token`. This contour, running as a
 * GitHub App inside Actions, had only ever been answered with the first; the consumer's
 * roles run on the second. The predicate demanded the word `integration`, so on the private
 * repository it answered "not this class", the second ask never happened, and the whole
 * door died with no guard printed — exactly the behaviour thread 160 had repaired.
 *
 * The message below is the one john measured on 2026-09-08 against the installed `0.2.13`.
 */
const PAT_REFUSAL =
  "GraphQL: Resource not accessible by personal access token (repository.pullRequest.statusCheckRollup.nodes.0.commit.statusCheckRollup.contexts.nodes.0), Resource not accessible by personal access token (repository.pullRequest.statusCheckRollup.nodes.0.commit.statusCheckRollup.contexts.nodes.1)";

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

  it("does not send the holder of a personal token after a permission that does not exist", () => {
    // The other actor (thread 172). `checks: read` is advice about a `permissions:` block
    // and has an addressee; the fine-grained set has no `checks` at all, so telling this
    // to john would be three rounds of #108 all over again in a new wording.
    const hint = ghRefusalHint(asThrown(PAT_REFUSAL));

    expect(hint).toContain("PERSONAL ACCESS TOKEN");
    expect(hint).toContain("runs of Actions");
    expect(hint).not.toContain("checks: read");
    expect(hint).not.toContain("actions: read");
  });

  it("promises the second ask only on the path the door actually asks again without", () => {
    // Found by the reviewer of #341 (thread 172): the branch above was chosen by the ACTOR
    // alone, so a `repository.projectV2` refused to the same personal token was answered
    // "the door drops the refused node and reads the checks from the runs of Actions" —
    // while `forbiddenChecksRollup` returns `undefined` for it, no second ask happens, and
    // the call dies with `was not read through gh`. The hint described a repair the door
    // did not perform: thread 026 in a third wording.
    const hint = ghRefusalHint(
      asThrown("GraphQL: Resource not accessible by personal access token (repository.projectV2)"),
    );

    expect(hint).toContain("PERSONAL ACCESS TOKEN");
    expect(hint).toContain("repository.projectV2");
    // The two claims that would be false here — the substitution, and a scope to add.
    expect(hint).not.toContain("runs of Actions");
    expect(hint).not.toContain("checks: read");
    expect(hint).not.toContain("actions: read");
    // And it says what IS true: nothing stood in for the refused node.
    expect(hint).toContain("was not read");
  });

  it("keeps the gate on the path when the actor is an installation token too", () => {
    // The same seam on the other actor: `repository.projectV2` refused `by integration`
    // takes the guess branch, which never claimed a substitution.
    const hint = ghRefusalHint(
      asThrown("GraphQL: Resource not accessible by integration (repository.projectV2)"),
    );

    expect(hint).not.toContain("runs of Actions");
    expect(hint).toContain("A guess and not the cause");
  });
});

describe("forbiddenChecksRollup — the actor is read, never demanded (thread 172)", () => {
  it("recognises the refusal of a fine-grained personal token", () => {
    expect(forbiddenChecksRollup(asThrown(PAT_REFUSAL))).toBe(
      "repository.pullRequest.statusCheckRollup.nodes.0.commit.statusCheckRollup.contexts.nodes.0",
    );
  });

  it("still recognises the refusal of an installation token", () => {
    expect(
      forbiddenChecksRollup(
        asThrown(
          "GraphQL: Resource not accessible by integration (repository.pullRequest.statusCheckRollup.contexts.nodes.0)",
        ),
      ),
    ).toBe("repository.pullRequest.statusCheckRollup.contexts.nodes.0");
  });

  it("is still decided by the PATH and not by the word — whoever was refused", () => {
    // The echoed command line carries `statusCheckRollup` on EVERY failure (thread 026).
    // Widening the actor must not widen this: a repository that resolves to nothing is not
    // repaired by asking the same question with one field less.
    expect(
      forbiddenChecksRollup(asThrown("GraphQL: Could not resolve to a Repository with the name")),
    ).toBeUndefined();
    expect(
      forbiddenChecksRollup(
        asThrown(
          "GraphQL: Resource not accessible by personal access token (repository.projectV2)",
        ),
      ),
    ).toBeUndefined();
    // A refusal that names no path at all decides nothing either: there is no second ask
    // that could be known to repair it.
    expect(
      forbiddenChecksRollup(asThrown("GraphQL: Resource not accessible by personal access token")),
    ).toBeUndefined();
  });
});

/**
 * THE MAPPING OF THE BASE (023.4). The defect this locks was invisible to every test of
 * the note itself: `PullRequestFacts.baseSha` was filled from `baseRefOid`, the head of
 * the base AS OF THE CUT of this branch. It is stable while the base moves — measured on
 * the live circuit on 2026-08-03, PR #192 reported `44471804` while `main` had gone to
 * `6b87776f`, and PR #3 (opened 24.07) reports a July commit to this day. Dated that way
 * the base is older than the checks essentially always, so the note said "current" about a
 * measurement nobody took. The base now arrives ONLY from the caller's second read.
 */
describe("pullRequestFacts — where the base comes from (023.4)", () => {
  const payload = {
    number: 192,
    headRefOid: "31fb029476f5a5ab2869cc62a39c959d4182f025",
    body: "thread: 023-daemon-parallelism",
    reviews: [],
    commits: [],
    statusCheckRollup: [],
    files: [],
    baseRefName: "main",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    // What the live payload of #192 carried while `main` was already three commits on.
    baseRefOid: "44471804",
  };

  it("takes the base from the MEASURED head, never from the payload", () => {
    const facts = pullRequestFacts(ghPullRequestSchema.parse(payload), {
      sha: "6b87776f",
      committedAt: "2026-08-03T15:42:33Z",
    });

    expect(facts.baseSha).toBe("6b87776f");
    expect(facts.baseCommittedAt).toBe("2026-08-03T15:42:33Z");
  });

  it("has no base at all when the caller measured none — the scheduler pays for no second read", () => {
    const facts = pullRequestFacts(ghPullRequestSchema.parse(payload));

    // Not `44471804`: an unmeasured base is ABSENT, and the note says so out loud.
    expect(facts.baseSha).toBeUndefined();
    expect(facts.baseCommittedAt).toBeUndefined();
  });
});
