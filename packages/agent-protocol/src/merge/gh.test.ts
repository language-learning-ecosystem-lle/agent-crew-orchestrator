/**
 * THE READING OF A REFUSAL. Every case here is a message `gh` actually returned during
 * thread 026 — the point of the file is that the hint used to answer "`checks: read`" to
 * all of them, and was right about at most one.
 */
import { describe, expect, it } from "vitest";
import {
  checkFactsFromRuns,
  ghPullRequestSchema,
  ghRefusalHint,
  pullRequestFacts,
  readCheckRuns,
} from "./gh.js";

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

/**
 * GUARD 2'S NEW SOURCE (thread 120): the runs of `actions/runs?head_sha=` read as the
 * attempts the gate judges. Every case here is a shape john or curator measured on the
 * live circuit on 2026-09-02 — the six `Notifier Watch: skipped` of head `0a612b27`
 * included, which is why "skipped" has a case of its own here and a class of its own in
 * `gate.ts`.
 */
describe("checkFactsFromRuns — the runs of THIS head, and nobody else's", () => {
  const head = "0a612b27c151a53ae53eec27e240f04b7866fa87";
  const run = (over: Record<string, unknown>) => ({
    id: 1,
    name: "CI",
    headSha: head,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-02T08:00:00Z",
    updatedAt: "2026-09-02T08:10:00Z",
    ...over,
  });

  it("drops a run that names another head — an outcome from another slice is not an outcome here", () => {
    const facts = checkFactsFromRuns([run({}), run({ name: "E2E", headSha: "34716450" })], head);

    expect(facts.map((check) => check.name)).toEqual(["CI"]);
  });

  it("keeps the Actions vocabulary as it is and dates a finished run by `updated_at`", () => {
    const [check] = checkFactsFromRuns([run({})], head);

    expect(check).toMatchObject({
      name: "CI",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-09-02T08:00:00Z",
      completedAt: "2026-09-02T08:10:00Z",
    });
  });

  it("does not date an unfinished run as completed — a flying attempt must not overtake the finished one it retries", () => {
    const [check] = checkFactsFromRuns([run({ status: "in_progress", conclusion: null })], head);

    expect(check?.completedAt).toBeUndefined();
    expect(check?.startedAt).toBe("2026-09-02T08:00:00Z");
  });
});

describe("readCheckRuns — a refusal is a state, never an empty list", () => {
  it("reads the runs of a healthy answer", () => {
    const reading = readCheckRuns(() =>
      JSON.stringify({
        workflow_runs: [
          { id: 7, name: "CI", head_sha: "abc", status: "completed", conclusion: "success" },
        ],
      }),
    );

    expect(reading.state).toBe("read");
    expect(reading.state === "read" && reading.runs[0]?.name).toBe("CI");
  });

  it("carries GitHub's own words when the token is refused — the sentence the door prints", () => {
    const reading = readCheckRuns(() => {
      throw new Error("HTTP 403: Resource not accessible by personal access token");
    });

    expect(reading.state).toBe("unreadable");
    expect(reading.state === "unreadable" && reading.reason).toContain(
      "Resource not accessible by personal access token",
    );
  });

  it("is unreadable — not empty — when the answer is not JSON or not the shape", () => {
    expect(readCheckRuns(() => "<html>502</html>").state).toBe("unreadable");
    expect(readCheckRuns(() => JSON.stringify({ runs: [] })).state).toBe("unreadable");
  });
});
