import { describe, expect, it } from "vitest";
import {
  describeMergeGate,
  evaluateMergeGate,
  latestVerdictPerAuthor,
  type PullRequestFacts,
  powerDocuments,
  readD1Reference,
  threadOfDescription,
  touchedPowerDocuments,
  unmatchedWorkingCards,
  withoutAnchor,
} from "./gate.js";

const HEAD = "6ab1bdf92d8d6b1689d3f25075c3e153f19be4f7";
const OLD = "1111111111111111111111111111111111111111";

const pr = (over: Partial<PullRequestFacts> = {}): PullRequestFacts => ({
  number: 51,
  headSha: HEAD,
  body: "thread: 026-curator-merge-right\nrole: dev-core\n\nbody",
  reviews: [{ state: "APPROVED", commitSha: HEAD, author: "github-actions" }],
  checks: [{ name: "checks", status: "COMPLETED", conclusion: "SUCCESS", state: undefined }],
  changedPaths: ["packages/agent-protocol/src/merge/gate.ts"],
  mergeable: "MERGEABLE",
  ...over,
});

/** A finished attempt of a check, stamped — the shape a rerun argument is made of. */
const attempt = (
  name: string,
  conclusion: string,
  completedAt: string,
): PullRequestFacts["checks"][number] => ({
  name,
  status: "COMPLETED",
  conclusion,
  state: undefined,
  completedAt,
});

const guard = (
  facts: PullRequestFacts,
  n: number,
  powerDocs: readonly string[] = ["PROTOCOL.md"],
) => evaluateMergeGate({ pr: facts, powerDocs }).guards.find((entry) => entry.guard === n);

describe("powerDocuments", () => {
  it("derives the config and every role's instruction paths, plus what the project declares", () => {
    expect(
      powerDocuments({
        configPath: "agent-protocol.json",
        roles: [
          { instructions: [{ path: "docs/roles/curator.md" }] },
          { instructions: [{ path: "CLAUDE.md" }] },
          {},
        ],
        declared: ["./PROTOCOL.md/"],
      }),
    ).toEqual(["agent-protocol.json", "docs/roles/curator.md", "CLAUDE.md", "PROTOCOL.md"]);
  });

  it("says each document once even when a role and the project name the same one", () => {
    expect(
      powerDocuments({
        configPath: "agent-protocol.json",
        roles: [{ instructions: [{ path: "REVIEWER.md" }] }],
        declared: ["REVIEWER.md"],
      }),
    ).toEqual(["agent-protocol.json", "REVIEWER.md"]);
  });

  it("subtracts a WORKING card from the derived side (john 2026-07-28: power runs by nature)", () => {
    expect(
      powerDocuments({
        configPath: "agent-protocol.json",
        roles: [
          { instructions: [{ path: "docs/roles/curator.md" }] },
          { instructions: [{ path: "CLAUDE.md" }] },
        ],
        workingCards: ["./CLAUDE.md"],
      }),
    ).toEqual(["agent-protocol.json", "docs/roles/curator.md"]);
  });

  it("but never from the DECLARED side — naming a path outright outranks calling it a working card", () => {
    expect(
      powerDocuments({
        configPath: "agent-protocol.json",
        roles: [{ instructions: [{ path: "CLAUDE.md" }] }],
        declared: ["CLAUDE.md"],
        workingCards: ["CLAUDE.md"],
      }),
    ).toEqual(["agent-protocol.json", "CLAUDE.md"]);
  });
});

describe("unmatchedWorkingCards", () => {
  it("names a working card no role points at — a flag that hits nothing looks like it works", () => {
    expect(
      unmatchedWorkingCards({
        roles: [{ instructions: [{ path: "CLAUDE.md" }] }, {}],
        workingCards: ["CLAUDE.md", "docs/notes.md"],
      }),
    ).toEqual(["docs/notes.md"]);
  });
});

describe("touchedPowerDocuments", () => {
  it("matches an entry as a path prefix, at a separator only", () => {
    expect(
      touchedPowerDocuments({
        changedPaths: ["docs/roles/curator.md", "docs/roles-old.md", "docs/roles"],
        powerDocs: ["docs/roles"],
      }),
    ).toEqual(["docs/roles/curator.md", "docs/roles"]);
  });
});

describe("threadOfDescription", () => {
  it("reads the thread line of the description", () => {
    expect(threadOfDescription("thread: 026-curator-merge-right\nrole: dev-core")).toBe(
      "026-curator-merge-right",
    );
  });

  it("is undefined when no line names a thread", () => {
    expect(threadOfDescription("role: dev-core\n\nsomething about a thread")).toBeUndefined();
  });
});

describe("guard 1 — approve on the current head", () => {
  it("passes on an approve submitted against the head", () => {
    expect(guard(pr(), 1)?.state).toBe("pass");
  });

  it("refuses when the head moved after the approve, and says where the approve sits", () => {
    const outcome = guard(pr({ reviews: [{ state: "APPROVED", commitSha: OLD, author: "r" }] }), 1);
    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("1111111");
    expect(outcome?.detail).toContain("6ab1bdf");
  });

  it("refuses when changes were requested on the head, even beside an approve", () => {
    const outcome = guard(
      pr({
        reviews: [
          { state: "APPROVED", commitSha: HEAD, author: "a" },
          { state: "CHANGES_REQUESTED", commitSha: HEAD, author: "b" },
        ],
      }),
      1,
    );
    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("b");
  });

  it("refuses when nobody has reviewed at all", () => {
    expect(guard(pr({ reviews: [] }), 1)?.state).toBe("fail");
  });
});

describe("guard 1 — one head answers more than once per reviewer (D4)", () => {
  /** A verdict of the one reviewer this project has, stamped. */
  const said = (
    state: string,
    submittedAt: string,
    commitSha: string = HEAD,
  ): PullRequestFacts["reviews"][number] => ({
    state,
    commitSha,
    author: "github-actions",
    submittedAt,
  });

  it("passes when a second round on the same head ended in approve", () => {
    const outcome = guard(
      pr({
        reviews: [
          said("CHANGES_REQUESTED", "2026-07-31T03:11:30Z"),
          said("APPROVED", "2026-07-31T03:33:07Z"),
        ],
      }),
      1,
    );
    expect(outcome?.state).toBe("pass");
    expect(outcome?.detail).toContain("github-actions");
  });

  it("refuses when the approve was overtaken by a later changes-requested", () => {
    const outcome = guard(
      pr({
        reviews: [
          said("APPROVED", "2026-07-31T03:11:30Z"),
          said("CHANGES_REQUESTED", "2026-07-31T03:33:07Z"),
        ],
      }),
      1,
    );
    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("a new round");
  });

  it("does not read the order of the array — the stamps decide, not the position", () => {
    expect(
      guard(
        pr({
          reviews: [
            said("APPROVED", "2026-07-31T03:33:07Z"),
            said("CHANGES_REQUESTED", "2026-07-31T03:11:30Z"),
          ],
        }),
        1,
      )?.state,
    ).toBe("pass");
  });

  it("judges the group whole when no stamp tells the verdicts apart — it refuses", () => {
    expect(
      guard(
        pr({
          reviews: [
            { state: "APPROVED", commitSha: HEAD, author: "github-actions" },
            { state: "CHANGES_REQUESTED", commitSha: HEAD, author: "github-actions" },
          ],
        }),
        1,
      )?.state,
    ).toBe("fail");
  });

  it("keeps an unstamped verdict in the answer — it cannot be shown to be the older one", () => {
    expect(
      guard(
        pr({
          reviews: [
            said("APPROVED", "2026-07-31T03:33:07Z"),
            { state: "CHANGES_REQUESTED", commitSha: HEAD, author: "github-actions" },
          ],
        }),
        1,
      )?.state,
    ).toBe("fail");
  });

  it("counts verdicts of the current head only — an old changes-requested is not a round", () => {
    expect(
      guard(
        pr({
          reviews: [
            said("CHANGES_REQUESTED", "2026-07-30T20:00:00Z", OLD),
            said("APPROVED", "2026-07-31T03:33:07Z"),
          ],
        }),
        1,
      )?.state,
    ).toBe("pass");
  });

  it("holds the last verdict of EACH reviewer — one open changes-requested still stops it", () => {
    const outcome = guard(
      pr({
        reviews: [
          said("APPROVED", "2026-07-31T03:33:07Z"),
          {
            state: "CHANGES_REQUESTED",
            commitSha: HEAD,
            author: "john",
            submittedAt: "2026-07-31T02:00:00Z",
          },
        ],
      }),
      1,
    );
    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("john");
  });

  it("does not let a comment overtake a verdict", () => {
    expect(
      guard(
        pr({
          reviews: [
            said("APPROVED", "2026-07-31T03:33:07Z"),
            said("COMMENTED", "2026-07-31T04:00:00Z"),
          ],
        }),
        1,
      )?.state,
    ).toBe("pass");
  });

  it("a dismissed verdict is not one either — a head with only that has not been answered", () => {
    expect(guard(pr({ reviews: [said("DISMISSED", "2026-07-31T03:33:07Z")] }), 1)?.state).toBe(
      "fail",
    );
  });

  /**
   * THE ANONYMOUS BOUNDARY. Not reproducible against today's GitHub — the one reviewer
   * is `github-actions` and always carries a login — which is exactly why it is pinned
   * here: a payload without an author is the case nobody would be watching when it
   * arrives (a deleted account, a system verdict), and grouping them together made the
   * door fail OPEN.
   */
  it("an unnamed changes-requested is not overtaken by a LATER unnamed approve", () => {
    const outcome = guard(
      pr({
        reviews: [
          {
            state: "CHANGES_REQUESTED",
            commitSha: HEAD,
            author: undefined,
            submittedAt: "2026-07-31T03:11:30Z",
          },
          {
            state: "APPROVED",
            commitSha: HEAD,
            author: undefined,
            submittedAt: "2026-07-31T03:33:07Z",
          },
        ],
      }),
      1,
    );
    expect(outcome?.state).toBe("fail");
  });

  it("but two rounds of the SAME named reviewer still resolve to the last one", () => {
    expect(
      guard(
        pr({
          reviews: [
            said("CHANGES_REQUESTED", "2026-07-31T03:11:30Z"),
            said("APPROVED", "2026-07-31T03:33:07Z"),
          ],
        }),
        1,
      )?.state,
    ).toBe("pass");
  });

  it("an unnamed verdict never joins a named reviewer's group either", () => {
    const outcome = guard(
      pr({
        reviews: [
          {
            state: "CHANGES_REQUESTED",
            commitSha: HEAD,
            author: undefined,
            submittedAt: "2026-07-31T03:11:30Z",
          },
          said("APPROVED", "2026-07-31T03:33:07Z"),
        ],
      }),
      1,
    );
    expect(outcome?.state).toBe("fail");
  });
});

describe("latestVerdictPerAuthor — the grouping itself", () => {
  const at = (state: string, author: string | undefined, submittedAt: string) => ({
    state,
    author,
    at: Date.parse(submittedAt),
  });

  it("keeps every unnamed verdict — each is its own group, none overtakes another", () => {
    const kept = latestVerdictPerAuthor([
      at("CHANGES_REQUESTED", undefined, "2026-07-31T03:11:30Z"),
      at("APPROVED", undefined, "2026-07-31T03:33:07Z"),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("still collapses the rounds of one named reviewer to the last", () => {
    const kept = latestVerdictPerAuthor([
      at("CHANGES_REQUESTED", "github-actions", "2026-07-31T03:11:30Z"),
      at("APPROVED", "github-actions", "2026-07-31T03:33:07Z"),
    ]);
    expect(kept.map((verdict) => verdict.state)).toEqual(["APPROVED"]);
  });

  /** The two halves of the key space are prefixed, so a login cannot land in the other. */
  it("does not let a login that reads like a generated key join an unnamed group", () => {
    const kept = latestVerdictPerAuthor([
      at("CHANGES_REQUESTED", undefined, "2026-07-31T03:11:30Z"),
      at("APPROVED", "unnamed:0", "2026-07-31T03:33:07Z"),
    ]);
    expect(kept).toHaveLength(2);
  });
});

/**
 * THE CLASS: the door reads the array of verdicts the wrong way — the same class as D1
 * and D4, one field deeper. `reviews[].commit.oid` of a verdict submitted without one is
 * not a fact but a substitution: it holds whatever head the PR carries at the moment of
 * the read, and the only thing that outs it is TIME — a verdict cannot answer about a
 * commit that did not exist yet.
 */
describe("guard 1 — a verdict older than the head commit (thread 043)", () => {
  const HEAD_MADE = "2026-07-31T06:55:57Z";
  /** How gh answers about a verdict submitted with no commit: the current head, whatever it is now. */
  const substituted = (
    state: string,
    submittedAt: string | undefined = "2026-07-31T03:46:02Z",
  ): PullRequestFacts["reviews"][number] => ({
    state,
    commitSha: HEAD,
    author: "github-actions",
    submittedAt,
  });

  it("refuses an approve submitted before the head commit existed — it answered about other code", () => {
    const outcome = guard(
      pr({ reviews: [substituted("APPROVED")], headCommittedAt: HEAD_MADE }),
      1,
    );

    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("older than the head commit");
    // The repair it names is a run of the review, not another round of review.
    expect(outcome?.detail).toContain("pull_request");
  });

  it("says something different from 'no approve' — the two are different repairs", () => {
    const detail = guard(
      pr({ reviews: [substituted("APPROVED")], headCommittedAt: HEAD_MADE }),
      1,
    )?.detail;

    expect(guard(pr({ reviews: [], headCommittedAt: HEAD_MADE }), 1)?.detail).toContain(
      "no approve verdict",
    );
    expect(detail).not.toContain("no approve verdict");
  });

  it("passes an approve submitted AFTER the head commit — the head has not moved under it", () => {
    expect(
      guard(
        pr({
          reviews: [substituted("APPROVED", "2026-07-31T08:59:35Z")],
          headCommittedAt: HEAD_MADE,
        }),
        1,
      )?.state,
    ).toBe("pass");
  });

  it("still refuses an approve on another head, and still passes one on this head", () => {
    expect(
      guard(
        pr({
          reviews: [
            {
              state: "APPROVED",
              commitSha: OLD,
              author: "github-actions",
              submittedAt: "2026-07-31T08:59:35Z",
            },
          ],
          headCommittedAt: HEAD_MADE,
        }),
        1,
      )?.state,
    ).toBe("fail");
    expect(
      guard(
        pr({
          reviews: [
            {
              state: "APPROVED",
              commitSha: HEAD,
              author: "github-actions",
              submittedAt: "2026-07-31T08:59:35Z",
            },
          ],
          headCommittedAt: HEAD_MADE,
        }),
        1,
      )?.state,
    ).toBe("pass");
  });

  it("does not read a verdict that predates the head as the stale one either", () => {
    expect(
      guard(pr({ reviews: [substituted("APPROVED")], headCommittedAt: HEAD_MADE }), 1)?.detail,
    ).not.toContain("the head has moved");
  });

  it("refuses a CHANGES_REQUESTED older than the head too — an unknown target opens no door", () => {
    expect(
      guard(
        pr({
          reviews: [
            substituted("CHANGES_REQUESTED"),
            {
              state: "APPROVED",
              commitSha: HEAD,
              author: "john",
              submittedAt: "2026-07-31T08:00:00Z",
            },
          ],
          headCommittedAt: HEAD_MADE,
        }),
        1,
      )?.state,
    ).toBe("fail");
  });

  it("refuses a verdict on the head that carries no stamp — its age cannot be shown", () => {
    expect(
      guard(pr({ reviews: [substituted("APPROVED", undefined)], headCommittedAt: HEAD_MADE }), 1)
        ?.state,
    ).toBe("fail");
  });

  it("reads exactly as before when gh did not date the head — nothing known, nothing invented", () => {
    expect(guard(pr({ reviews: [substituted("APPROVED")] }), 1)?.state).toBe("pass");
  });

  /**
   * THE REFUSAL MUST NOT OUTLIVE ITS OWN REPAIR. The dispatch record never leaves
   * `reviews`, and `gh` keeps showing it against the current head — so asking the age of
   * the HISTORY instead of the last verdict of each author locked the door forever on
   * every PR a dispatch run had ever touched, the `pull_request` round the refusal itself
   * names included.
   */
  it("lets a fresh pull_request approve overtake the same author's dispatch verdict on this head", () => {
    const outcome = guard(
      pr({
        reviews: [
          // The old workflow_dispatch verdict: shown against the head, submitted before it.
          substituted("APPROVED"),
          // The repair the refusal names — the same author, a run on the 'pull_request' event.
          substituted("APPROVED", "2026-07-31T09:00:00Z"),
        ],
        headCommittedAt: HEAD_MADE,
      }),
      1,
    );

    expect(outcome?.state).toBe("pass");
    expect(outcome?.detail).toContain("approved on");
  });

  it("keeps refusing when the author's LAST word is the anchorless one — being overtaken is what clears a verdict", () => {
    expect(
      guard(
        pr({
          reviews: [
            substituted("APPROVED", "2026-07-31T09:00:00Z"),
            // Submitted later than the valid approve, but still before the head existed:
            // impossible in life, and the door does not reward an unreadable payload.
            substituted("APPROVED", "2026-07-31T03:46:02Z"),
          ],
          headCommittedAt: "2026-07-31T09:30:00Z",
        }),
        1,
      )?.state,
    ).toBe("fail");
  });

  it("does not let one author's dispatch verdict be cleared by ANOTHER author's approve", () => {
    const outcome = guard(
      pr({
        reviews: [
          substituted("APPROVED"),
          {
            state: "APPROVED",
            commitSha: HEAD,
            author: "curator",
            submittedAt: "2026-07-31T09:00:00Z",
          },
        ],
        headCommittedAt: HEAD_MADE,
      }),
      1,
    );

    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("older than the head commit");
  });
});

describe("withoutAnchor", () => {
  const HEAD_MADE = "2026-07-31T06:55:57Z";

  it("takes only the verdicts ON THE HEAD that predate it — one on another commit is not its business", () => {
    const old = {
      state: "APPROVED",
      commitSha: OLD,
      author: "john",
      submittedAt: "2026-07-30T00:00:00Z",
    };
    const predating = {
      state: "APPROVED",
      commitSha: HEAD,
      author: "github-actions",
      submittedAt: "2026-07-31T03:46:02Z",
    };
    const after = {
      state: "APPROVED",
      commitSha: HEAD,
      author: "curator",
      submittedAt: "2026-07-31T08:59:35Z",
    };

    expect(
      withoutAnchor({
        reviews: [old, predating, after],
        headSha: HEAD,
        headCommittedAt: HEAD_MADE,
      }),
    ).toEqual([predating]);
  });

  it("is empty when gh did not date the head — the old reading, unchanged", () => {
    expect(
      withoutAnchor({
        reviews: [{ state: "APPROVED", commitSha: HEAD, author: "r" }],
        headSha: HEAD,
      }),
    ).toEqual([]);
  });
});

describe("guard 2 — green checks on the same head", () => {
  it("counts a neutral and a skipped run as green", () => {
    expect(
      guard(
        pr({
          checks: [
            { name: "checks", status: "COMPLETED", conclusion: "SUCCESS", state: undefined },
            { name: "review", status: "COMPLETED", conclusion: "SKIPPED", state: undefined },
            { name: "notify", status: "COMPLETED", conclusion: "NEUTRAL", state: undefined },
          ],
        }),
        2,
      )?.state,
    ).toBe("pass");
  });

  it("refuses a run that has not answered yet", () => {
    const outcome = guard(
      pr({
        checks: [
          { name: "checks", status: "IN_PROGRESS", conclusion: undefined, state: undefined },
        ],
      }),
      2,
    );
    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("checks=");
  });

  it("refuses a failure", () => {
    expect(
      guard(
        pr({
          checks: [
            { name: "checks", status: "COMPLETED", conclusion: "FAILURE", state: undefined },
          ],
        }),
        2,
      )?.state,
    ).toBe("fail");
  });

  it("reads a status context by its state", () => {
    expect(
      guard(
        pr({
          checks: [{ name: "legacy", status: undefined, conclusion: undefined, state: "SUCCESS" }],
        }),
        2,
      )?.state,
    ).toBe("pass");
  });

  it("refuses a head no check has reported on", () => {
    expect(guard(pr({ checks: [] }), 2)?.state).toBe("fail");
  });
});

/**
 * D1 — the four cases of the statement of work of 2026-07-31. The live payload behind
 * them is #89 at `f7171a5`: `review` FAILURE at 00:05:30Z and `review` SUCCESS at
 * 00:20:41Z on ONE head, which made the door refuse a merge for an outcome a rerun had
 * already replaced.
 */
describe("guard 2 — one head answers once per check name", () => {
  it("takes the rerun, not the failure it replaced (#89 at f7171a5)", () => {
    const outcome = guard(
      pr({
        checks: [
          attempt("review", "FAILURE", "2026-07-30T00:05:30Z"),
          attempt("checks", "SUCCESS", "2026-07-30T00:04:05Z"),
          attempt("review", "SUCCESS", "2026-07-30T00:20:41Z"),
          attempt("pronunciation", "SUCCESS", "2026-07-29T23:58:09Z"),
        ],
      }),
      2,
    );
    expect(outcome?.state).toBe("pass");
    expect(outcome?.detail).toContain("3 check(s) green");
    expect(outcome?.detail).toContain("review=SUCCESS");
    expect(outcome?.detail).not.toContain("FAILURE");
  });

  it("takes the rerun the other way round too — a later failure buries an earlier success", () => {
    const outcome = guard(
      pr({
        checks: [
          attempt("review", "SUCCESS", "2026-07-30T00:05:30Z"),
          attempt("review", "FAILURE", "2026-07-30T00:20:41Z"),
        ],
      }),
      2,
    );
    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("review=FAILURE");
  });

  it("does not let an older success swallow a rerun that is still flying", () => {
    const outcome = guard(
      pr({
        checks: [
          attempt("review", "SUCCESS", "2026-07-30T00:05:30Z"),
          {
            name: "review",
            status: "IN_PROGRESS",
            conclusion: "",
            state: undefined,
            startedAt: "2026-07-30T00:20:41Z",
          },
        ],
      }),
      2,
    );
    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("review=IN_PROGRESS");
  });

  it("judges the whole group when no stamp tells the attempts apart — a door does not guess", () => {
    expect(
      guard(
        pr({
          checks: [
            { name: "review", status: "COMPLETED", conclusion: "FAILURE", state: undefined },
            { name: "review", status: "COMPLETED", conclusion: "SUCCESS", state: undefined },
          ],
        }),
        2,
      )?.state,
    ).toBe("fail");
  });

  it("leaves a single set without reruns exactly as it was", () => {
    const outcome = guard(
      pr({
        checks: [
          attempt("checks", "SUCCESS", "2026-07-30T00:04:05Z"),
          attempt("review", "SUCCESS", "2026-07-30T00:20:41Z"),
        ],
      }),
      2,
    );
    expect(outcome?.state).toBe("pass");
    expect(outcome?.detail).toContain("2 check(s) green");
  });
});

/** D3 — `gh` says "no conclusion yet" with an empty string, and `??` reads it as one. */
describe("guard 2 — a flying check is named, not printed blank", () => {
  it("names what gh actually returned instead of 'review='", () => {
    const outcome = guard(
      pr({
        checks: [{ name: "review", status: "IN_PROGRESS", conclusion: "", state: undefined }],
      }),
      2,
    );
    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("review=IN_PROGRESS");
    expect(outcome?.detail).not.toContain("review=,");
    expect(outcome?.detail.endsWith("review=")).toBe(false);
  });
});

/** D2 — what GitHub itself would refuse, said beside the guards and never as one. */
describe("mergeability — a fact beside the guards", () => {
  const answer = (facts: PullRequestFacts) =>
    evaluateMergeGate({ pr: facts, powerDocs: ["PROTOCOL.md"] });

  it("says nothing that stops the merge when the tree applies", () => {
    const verdict = answer(pr({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }));
    expect(verdict.mergeability.state).toBe("clear");
    expect(verdict.curatorMayMerge).toBe(true);
  });

  it("refuses a conflicting tree even when every guard holds", () => {
    const verdict = answer(pr({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }));
    expect(verdict.guards.some((entry) => entry.state === "fail")).toBe(false);
    expect(verdict.curatorMayMerge).toBe(false);
    expect(verdict.mergeability.detail).toContain("CONFLICTING");
    expect(verdict.mergeability.detail).toContain("DIRTY");
    const lines = describeMergeGate(verdict);
    expect(lines.some((line) => line.includes("mergeability · not a guard"))).toBe(true);
    expect(lines.at(-1)).toContain("GitHub itself would refuse");
  });

  it("refuses UNKNOWN by name — 'not computed yet' is not a permission", () => {
    const verdict = answer(pr({ mergeable: "UNKNOWN" }));
    expect(verdict.curatorMayMerge).toBe(false);
    expect(verdict.mergeability.detail).toContain("has not finished computing");
  });

  it("refuses a payload that reports no mergeable at all", () => {
    const verdict = answer(pr({ mergeable: undefined }));
    expect(verdict.curatorMayMerge).toBe(false);
    expect(verdict.mergeability.detail).toContain("no 'mergeable' field");
  });

  it("is still not a sixth guard — the five are the five", () => {
    expect(answer(pr({ mergeable: "CONFLICTING" })).guards.map((entry) => entry.guard)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
});

describe("guard 3 — ascent to a decision of john's", () => {
  it("stays with the human when the description names its thread", () => {
    const outcome = guard(pr(), 3);
    expect(outcome?.state).toBe("by-hand");
    expect(outcome?.detail).toContain("026-curator-merge-right");
  });

  it("refuses when there is no thread to ascend to", () => {
    expect(guard(pr({ body: "role: dev-core" }), 3)?.state).toBe("fail");
  });
});

describe("guard 4 — no self-merge on the documents of power", () => {
  it("passes when the change touches none of them", () => {
    expect(guard(pr(), 4)?.state).toBe("pass");
  });

  it("refuses and names the documents when it does", () => {
    const outcome = guard(pr({ changedPaths: ["PROTOCOL.md", "README.md"] }), 4);
    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("PROTOCOL.md");
    expect(outcome?.detail).not.toContain("README.md");
  });
});

/**
 * 068 — CLASS Д-1, DECLARED AT THE DOOR (john's decision of 2026-08-14). The three states
 * of guard 4, and the line that reads them: without the flag nothing moves, with it on a
 * document of power the STOP becomes an obligation, with it on anything else it says so.
 */
describe("guard 4 and class Д-1", () => {
  const REFERENCE = "068-d1-vs-guard4/2026-08-14T09-56-40Z-curator.md";
  const d1 = {
    thread: "068-d1-vs-guard4",
    file: "2026-08-14T09-56-40Z-curator.md",
    raw: REFERENCE,
  };
  const answer = (over: Partial<PullRequestFacts> = {}, declared = d1) =>
    evaluateMergeGate({ pr: pr(over), powerDocs: ["docs/roles"], d1: declared });
  const four = (verdict: ReturnType<typeof answer>) =>
    verdict.guards.find((entry) => entry.guard === 4);

  it("without the flag the STOP stands, word for word — half of the whole repair", () => {
    const verdict = evaluateMergeGate({
      pr: pr({ changedPaths: ["docs/roles/curator.md"] }),
      powerDocs: ["docs/roles"],
    });
    expect(four(verdict)?.state).toBe("fail");
    expect(four(verdict)?.detail).toBe("john merges this one — it changes docs/roles/curator.md");
    expect(verdict.curatorMayMerge).toBe(false);
  });

  it("with it, a document of power becomes an obligation — never a pass", () => {
    const verdict = answer({ changedPaths: ["docs/roles/curator.md"] });
    const outcome = four(verdict);

    expect(outcome?.state).toBe("by-hand");
    // Both facts, by the statement of work: which paths of power, and the reference.
    expect(outcome?.detail).toContain("docs/roles/curator.md");
    expect(outcome?.detail).toContain(REFERENCE);
    expect(outcome?.detail).toContain("ONLY encode");
    expect(verdict.curatorMayMerge).toBe(true);
  });

  it("says the flag changed nothing when the diff touches no document of power", () => {
    const verdict = answer();
    expect(four(verdict)?.state).toBe("pass");
    expect(four(verdict)?.detail).toContain("changed nothing here");
    expect(four(verdict)?.detail).toContain(REFERENCE);
  });

  it("a thread of its own is printed, not refused — a decision is fixed where it was taken", () => {
    // The PR belongs to `026-curator-merge-right`; the decision is fixed in 068.
    const verdict = answer({ changedPaths: ["docs/roles/curator.md"] });
    expect(four(verdict)?.state).toBe("by-hand");
    expect(four(verdict)?.detail).toContain("068-d1-vs-guard4");
    expect(four(verdict)?.detail).toContain("026-curator-merge-right");
    expect(four(verdict)?.detail).toContain("not a refusal");
  });

  it("says nothing about a difference that is not there", () => {
    const verdict = answer(
      { body: "thread: 068-d1-vs-guard4\nrole: curator", changedPaths: ["docs/roles/curator.md"] },
      d1,
    );
    expect(four(verdict)?.detail).not.toContain("not a refusal");
  });

  it("the closing line names guard 4 among the obligations (it used to name two from memory)", () => {
    const verdict = answer({ changedPaths: ["docs/roles/curator.md"] });
    expect(describeMergeGate(verdict).at(-1)).toBe(
      "nothing in the facts forbids this merge — guards 3, 4 and 5 are yours to answer",
    );
    // And the guard is printed as an obligation, in the same column as 3 and 5.
    expect(describeMergeGate(verdict).some((line) => line.startsWith("  you  guard 4"))).toBe(true);
  });

  it("leaves the line alone when no class is declared", () => {
    expect(describeMergeGate(evaluateMergeGate({ pr: pr(), powerDocs: [] })).at(-1)).toBe(
      "nothing in the facts forbids this merge — guards 3 and 5 are yours to answer",
    );
  });

  it("does not open anything else: a failed guard is still a refusal", () => {
    const verdict = answer({
      changedPaths: ["docs/roles/curator.md"],
      reviews: [{ state: "APPROVED", commitSha: OLD, author: "reviewer-pr" }],
    });
    expect(verdict.curatorMayMerge).toBe(false);
    expect(describeMergeGate(verdict).at(-1)).toContain("REFUSED");
  });
});

/** The FORM of the reference — the one half of condition (б) a machine can hold. */
describe("readD1Reference", () => {
  it("reads the short form: the thread and the message file", () => {
    expect(readD1Reference("068-d1-vs-guard4/2026-08-14T09-56-40Z-curator.md")).toEqual({
      thread: "068-d1-vs-guard4",
      file: "2026-08-14T09-56-40Z-curator.md",
      raw: "068-d1-vs-guard4/2026-08-14T09-56-40Z-curator.md",
    });
  });

  it("reads the full path the mail is stored under", () => {
    const read = readD1Reference(
      "agent-comms/068-d1-vs-guard4/messages/2026-08-14T09-56-40Z-curator.md",
    );
    expect(read).toMatchObject({
      thread: "068-d1-vs-guard4",
      file: "2026-08-14T09-56-40Z-curator.md",
    });
  });

  it("reads the other canonical writing of the moment — thread show reads both", () => {
    expect(readD1Reference("068-d1/2026-08-14T09:56:40Z-curator.md")).toMatchObject({
      file: "2026-08-14T09:56:40Z-curator.md",
    });
  });

  it("refuses a bare thread by name — the class ascends to a MESSAGE", () => {
    for (const bare of ["066", "066-test-gaps"]) {
      const read = readD1Reference(bare);
      expect(read).toHaveProperty("refusal");
      expect((read as { refusal: string }).refusal).toContain("names no message file");
    }
  });

  it("refuses an ordinal by its own name — ordinals travel (norm 024)", () => {
    const read = readD1Reference("066-test-gaps/msg-003");
    expect((read as { refusal: string }).refusal).toContain("ordinals travel");
  });

  it("refuses a value that is not a message file at all", () => {
    expect(readD1Reference("068-d1-vs-guard4/decision")).toHaveProperty("refusal");
    expect(readD1Reference("068-d1-vs-guard4/notes.md")).toHaveProperty("refusal");
    expect(readD1Reference("   ")).toHaveProperty("refusal");
  });
});

describe("the verdict", () => {
  it("allows the merge when every fact holds — and still leaves guards 3 and 5 open", () => {
    const verdict = evaluateMergeGate({ pr: pr(), powerDocs: ["PROTOCOL.md"] });
    expect(verdict.curatorMayMerge).toBe(true);
    expect(verdict.guards.filter((entry) => entry.state === "by-hand").map((e) => e.guard)).toEqual(
      [3, 5],
    );
    expect(describeMergeGate(verdict).at(-1)).toContain("guards 3 and 5 are yours");
  });

  it("refuses as soon as one fact does not hold", () => {
    const verdict = evaluateMergeGate({
      pr: pr({ changedPaths: ["docs/roles/curator.md"] }),
      powerDocs: ["docs/roles"],
    });
    expect(verdict.curatorMayMerge).toBe(false);
    expect(describeMergeGate(verdict).at(-1)).toContain("REFUSED");
  });

  it("never reports guard 5 as passed — a trace cannot be observed before the merge", () => {
    const verdict = evaluateMergeGate({ pr: pr(), powerDocs: [] });
    expect(verdict.guards.find((entry) => entry.guard === 5)?.state).toBe("by-hand");
  });
});

/**
 * 023.3 — WHAT GUARD 2 DOES NOT ASK, said beside it. The scope is "only speak": every
 * test here asserts the words AND that the answer is byte-for-byte the answer without them.
 */
describe("the base under a credited check — a note beside guard 2", () => {
  const BASE = "2222222222222222222222222222222222222222";
  /** A green attempt with the one stamp the base is dated against — its START. */
  const started = (name: string, startedAt: string): PullRequestFacts["checks"][number] => ({
    name,
    status: "COMPLETED",
    conclusion: "SUCCESS",
    state: undefined,
    startedAt,
    completedAt: "2026-08-03T14:10:00Z",
  });
  const answer = (over: Partial<PullRequestFacts> = {}) =>
    evaluateMergeGate({ pr: pr(over), powerDocs: ["PROTOCOL.md"] });
  const note = (verdict: ReturnType<typeof answer>): string | undefined =>
    describeMergeGate(verdict).find((line) => line.includes("note · base:"));

  it("names the drift when the base moved after the credited check started — the window of thread 023", () => {
    const verdict = answer({
      checks: [started("checks", "2026-08-03T13:47:19Z")],
      baseSha: BASE,
      baseCommittedAt: "2026-08-03T14:00:28Z",
    });

    expect(verdict.baseDrift.state).toBe("drift");
    expect(verdict.baseDrift.detail).toContain("2026-08-03T14:00:28Z");
    expect(verdict.baseDrift.detail).toContain("2026-08-03T13:47:19Z");
    expect(note(verdict)).toContain("moved AFTER");
    // The line hangs under guard 2 and nowhere else.
    const lines = describeMergeGate(verdict);
    expect(lines[lines.findIndex((line) => line.includes("guard 2")) + 1]).toContain("note · base");
  });

  it("says nothing when the base is older than every credited check — the one earned silence", () => {
    const verdict = answer({
      checks: [started("checks", "2026-08-03T14:05:00Z")],
      baseSha: BASE,
      baseCommittedAt: "2026-08-03T14:00:28Z",
    });

    expect(verdict.baseDrift.state).toBe("current");
    expect(note(verdict)).toBeUndefined();
  });

  it("compares the EARLIEST credited start — guard 2 credits them all", () => {
    const verdict = answer({
      checks: [started("checks", "2026-08-03T13:47:19Z"), started("e2e", "2026-08-03T14:30:00Z")],
      baseSha: BASE,
      baseCommittedAt: "2026-08-03T14:00:28Z",
    });

    expect(verdict.baseDrift.state).toBe("drift");
    expect(verdict.baseDrift.detail).toContain("'checks' started");
  });

  it("an unreadable base is NAMED, never folded into silence", () => {
    const noBase = answer({ checks: [started("checks", "2026-08-03T14:05:00Z")] });
    expect(noBase.baseDrift.state).toBe("unknown");
    expect(noBase.baseDrift.detail).toContain("the head of the base branch was not read");
    expect(note(noBase)).toContain("UNKNOWN");

    const noDate = answer({
      checks: [started("checks", "2026-08-03T14:05:00Z")],
      baseSha: BASE,
      baseCommittedAt: "   ",
    });
    expect(noDate.baseDrift.state).toBe("unknown");
    expect(noDate.baseDrift.detail).toContain("no readable date");

    const badDate = answer({
      checks: [started("checks", "2026-08-03T14:05:00Z")],
      baseSha: BASE,
      baseCommittedAt: "yesterday",
    });
    expect(badDate.baseDrift.state).toBe("unknown");
  });

  it("a credited check with no start stamp is NAMED — it cannot be dated against anything", () => {
    const verdict = answer({
      checks: [{ name: "checks", status: "COMPLETED", conclusion: "SUCCESS", state: undefined }],
      baseSha: BASE,
      baseCommittedAt: "2026-08-03T14:00:28Z",
    });

    expect(verdict.baseDrift.state).toBe("unknown");
    expect(verdict.baseDrift.detail).toContain("no start stamp on checks");
  });

  it("says so when guard 2 credits nothing — there is no reading whose base could have moved", () => {
    const verdict = answer({
      checks: [{ name: "checks", status: "COMPLETED", conclusion: "FAILURE", state: undefined }],
      baseSha: BASE,
      baseCommittedAt: "2026-08-03T14:00:28Z",
    });

    expect(verdict.baseDrift.state).toBe("unknown");
    expect(verdict.baseDrift.detail).toContain("no green attempt is credited");
  });

  it("CHANGES NOTHING: the verdict and every guard are identical with the drift and without it", () => {
    const checks = [started("checks", "2026-08-03T13:47:19Z")];
    const drifted = answer({ checks, baseSha: BASE, baseCommittedAt: "2026-08-03T14:00:28Z" });
    const quiet = answer({ checks, baseSha: BASE, baseCommittedAt: "2026-08-03T13:00:00Z" });
    const blind = answer({ checks });

    for (const verdict of [quiet, blind]) {
      expect(verdict.curatorMayMerge).toBe(drifted.curatorMayMerge);
      expect(verdict.guards).toEqual(drifted.guards);
      expect(verdict.mergeability).toEqual(drifted.mergeability);
    }
    expect(drifted.curatorMayMerge).toBe(true);
    // And it is not a guard: the five are still the five.
    expect(drifted.guards.map((entry) => entry.guard)).toEqual([1, 2, 3, 4, 5]);
    // The only difference in the print is the note itself.
    expect(describeMergeGate(drifted).filter((line) => !line.includes("note · base:"))).toEqual(
      describeMergeGate(quiet),
    );
  });

  it("a drift under a REFUSING door does not change the refusal either", () => {
    const refused = answer({
      checks: [started("checks", "2026-08-03T13:47:19Z")],
      changedPaths: ["PROTOCOL.md"],
      baseSha: BASE,
      baseCommittedAt: "2026-08-03T14:00:28Z",
    });

    expect(refused.baseDrift.state).toBe("drift");
    expect(refused.curatorMayMerge).toBe(false);
    expect(describeMergeGate(refused).at(-1)).toContain("REFUSED");
  });
});
