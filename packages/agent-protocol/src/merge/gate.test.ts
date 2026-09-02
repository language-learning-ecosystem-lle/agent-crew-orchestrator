import { describe, expect, it } from "vitest";
import {
  checksOutcome,
  describeMergeGate,
  describePowerDocuments,
  describeVersionBumpFollowUp,
  evaluateMergeGate,
  latestVerdictPerAuthor,
  type PullRequestFacts,
  powerDocumentList,
  powerDocuments,
  readD1Reference,
  threadOfDescription,
  touchedPowerDocuments,
  unmatchedWorkingCards,
  withoutAnchor,
} from "./gate.js";

const HEAD = "6ab1bdf92d8d6b1689d3f25075c3e153f19be4f7";
const OLD = "1111111111111111111111111111111111111111";

/**
 * A round of review that was open the whole of the era these fixtures live in (thread 027) —
 * so a verdict of ANY of them is anchored by it, and a test that is not about the anchor does
 * not have to state one. The cases that ARE about it name their own windows.
 */
const ROUND_ON_HEAD: PullRequestFacts["reviewRuns"] = {
  state: "read",
  workflow: "Claude PR Review",
  runs: [
    {
      id: 1,
      name: "Claude PR Review",
      headSha: HEAD,
      event: "pull_request",
      status: "completed",
      conclusion: "success",
      createdAt: "2000-01-01T00:00:00Z",
      updatedAt: "2100-01-01T00:00:00Z",
    },
  ],
};

const pr = (over: Partial<PullRequestFacts> = {}): PullRequestFacts => ({
  number: 51,
  headSha: HEAD,
  body: "thread: 026-curator-merge-right\nrole: dev-core\n\nbody",
  reviews: [
    {
      state: "APPROVED",
      commitSha: HEAD,
      author: "github-actions",
      submittedAt: "2026-07-30T00:10:00Z",
    },
  ],
  reviewRuns: ROUND_ON_HEAD,
  // The runs WERE read (thread 120): guard 2 has a source, and the attempts below are what
  // it answered. A fact built without this reads as `not-asked` and refuses, on purpose.
  checkRuns: { state: "read", runs: [] },
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

describe("powerDocuments: the DECLARED half — 'powerDocuments' of the config (v18, thread 025)", () => {
  it("makes guard 4 STOP on a declared path with NO flag in the invocation", () => {
    // The whole of thread 025 in one assertion: the completeness of guard 4 used to equal
    // the memory of whoever typed `--power-docs`, and this call types nothing.
    const powerDocs = powerDocuments({
      configPath: "agent-protocol.json",
      roles: [{ instructions: [{ path: "docs/roles/curator.md" }] }],
      configured: ["PROTOCOL.md", "REVIEWER.md", ".github/workflows"],
    });
    const outcome = guard(pr({ changedPaths: ["PROTOCOL.md"] }), 4, powerDocs);
    // "STOP" in the words of the statement of work is `fail` in the words of this door —
    // the state that takes `curatorMayMerge` down, so it is asserted here too and not
    // only through the guard's own field.
    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("PROTOCOL.md");
    expect(
      evaluateMergeGate({ pr: pr({ changedPaths: ["PROTOCOL.md"] }), powerDocs }).curatorMayMerge,
    ).toBe(false);
  });

  it("matches a declared DIRECTORY the way zones do — everything under the prefix", () => {
    const powerDocs = powerDocuments({
      configPath: "agent-protocol.json",
      roles: [],
      configured: [".github/workflows"],
    });
    expect(
      touchedPowerDocuments({ changedPaths: [".github/workflows/checks.yml"], powerDocs }),
    ).toEqual([".github/workflows/checks.yml"]);
  });

  it("the flag keeps ADDING to the declared list — both halves are judged, not one of them", () => {
    expect(
      powerDocuments({
        configPath: "agent-protocol.json",
        roles: [],
        configured: ["PROTOCOL.md"],
        declared: ["MIGRATION.md"],
      }),
    ).toEqual(["agent-protocol.json", "PROTOCOL.md", "MIGRATION.md"]);
  });

  it("a config with no 'powerDocuments' is bit-for-bit what the same call answered at v17", () => {
    const input = {
      configPath: "agent-protocol.json",
      roles: [{ instructions: [{ path: "docs/roles/curator.md" }] }],
      declared: ["PROTOCOL.md"],
      workingCards: ["CLAUDE.md"],
    };
    expect(powerDocuments({ ...input, configured: undefined })).toEqual(powerDocuments(input));
    expect(powerDocuments({ ...input, configured: [] })).toEqual(powerDocuments(input));
    expect(powerDocuments(input)).toEqual([
      "agent-protocol.json",
      "docs/roles/curator.md",
      "PROTOCOL.md",
    ]);
  });
});

describe("powerDocumentList: every path says where it came from", () => {
  const list = () =>
    powerDocumentList({
      configPath: "agent-protocol.json",
      roles: [{ instructions: [{ path: "docs/roles/curator.md" }] }],
      configured: ["PROTOCOL.md"],
      declared: ["MIGRATION.md"],
    });

  it("names the source of each of the four kinds", () => {
    expect(list()).toEqual([
      { path: "agent-protocol.json", source: "config" },
      { path: "docs/roles/curator.md", source: "role" },
      { path: "PROTOCOL.md", source: "declared" },
      { path: "MIGRATION.md", source: "flag" },
    ]);
  });

  it("a path that is both derived and declared is DERIVED: the derivation holds without it", () => {
    expect(
      powerDocumentList({
        configPath: "agent-protocol.json",
        roles: [{ instructions: [{ path: "REVIEWER.md" }] }],
        configured: ["REVIEWER.md"],
      }),
    ).toEqual([
      { path: "agent-protocol.json", source: "config" },
      { path: "REVIEWER.md", source: "role" },
    ]);
  });

  it("the trace prints the source beside every path", () => {
    const lines = describePowerDocuments(list()).join("\n");
    expect(lines).toContain("documents of power judged by (4)");
    expect(lines).toContain("PROTOCOL.md — declared by 'powerDocuments' of the config");
    expect(lines).toContain("MIGRATION.md — named on the command line by --power-docs");
    expect(lines).toContain("docs/roles/curator.md — derived from a role's instructions");
  });

  it("says out loud when the config declares NOTHING — a short list must not read as a full one", () => {
    const lines = describePowerDocuments(
      powerDocumentList({ configPath: "agent-protocol.json", roles: [] }),
    ).join("\n");
    expect(lines).toContain("the config declares no 'powerDocuments'");
  });

  it("and stays silent about it as soon as the config does declare something", () => {
    const lines = describePowerDocuments(list()).join("\n");
    expect(lines).not.toContain("declares no 'powerDocuments'");
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

/**
 * THE ANCHOR OF THREAD 027 — the defect measured on the served project's PR #347 of
 * 2026-08-21: a round of review that started on one head, a push mid-round, and a verdict
 * GitHub hung on the NEW head although the text answered about the old tree. Every fixture
 * here carries the recorded numbers, so the case that produced the repair is the case the
 * suite refuses.
 */
describe("guard 1 — the round of review behind the approve (thread 027)", () => {
  /** The heads of #347: the tree the round read, and the one the push made mid-round. */
  const READ_HEAD = `34716450${"0".repeat(32)}`;
  const PUSHED_HEAD = `e7386435${"0".repeat(32)}`;
  const REVIEW = "Claude PR Review";

  const run = (over: Record<string, unknown> = {}) => ({
    id: 32534201968,
    name: REVIEW,
    headSha: READ_HEAD,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-21T22:40:00Z",
    updatedAt: "2026-08-21T22:54:35Z",
    ...over,
  });

  /** #347 as it stood: the verdict of 22:54:33Z, hung by GitHub on the head of 22:48:38Z. */
  const orphan = (reviewRuns: PullRequestFacts["reviewRuns"]): PullRequestFacts =>
    pr({
      headSha: PUSHED_HEAD,
      headCommittedAt: "2026-08-21T22:48:38Z",
      reviews: [
        {
          state: "APPROVED",
          commitSha: PUSHED_HEAD,
          author: "github-actions",
          submittedAt: "2026-08-21T22:54:33Z",
        },
      ],
      reviewRuns,
    });

  it("(а) credits an approve that lies inside the window of a round on THIS head", () => {
    const outcome = guard(
      orphan({
        state: "read",
        workflow: REVIEW,
        // The healthy shape, #348: the round ran on the head the verdict is shown against.
        runs: [run({ id: 32535411165, headSha: PUSHED_HEAD })],
      }),
      1,
    );

    expect(outcome?.state).toBe("pass");
    expect(outcome?.detail).toContain("inside the round 32535411165");
  });

  it("(б) STOPS the recorded orphan of #347 — the round read 3471645, the verdict hangs on e738643", () => {
    const outcome = guard(orphan({ state: "read", workflow: REVIEW, runs: [run()] }), 1);

    expect(outcome?.state).toBe("fail");
    // The run is named with the head it actually read: that is the whole discrimination.
    expect(outcome?.detail).toContain("no CLOSED round of 'Claude PR Review' on e738643");
    expect(outcome?.detail).toContain("head 3471645");
    expect(outcome?.detail).toContain("32534201968");
  });

  it("(б') STOPS a verdict that lies outside the window of a round that IS on this head", () => {
    const outcome = guard(
      orphan({
        state: "read",
        workflow: REVIEW,
        runs: [
          run({
            headSha: PUSHED_HEAD,
            createdAt: "2026-08-21T23:00:00Z",
            updatedAt: "2026-08-21T23:05:00Z",
          }),
        ],
      }),
      1,
    );

    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("lies OUTSIDE every closed round");
  });

  it("(в) STOPS when no round of the reviewer's workflow is reported for the head at all", () => {
    const outcome = guard(orphan({ state: "read", workflow: REVIEW, runs: [] }), 1);

    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("no round of 'Claude PR Review' is reported for e738643");
  });

  it("(г) an Actions resource the token cannot read is by-hand with GitHub's own words", () => {
    const outcome = guard(
      orphan({
        state: "unreadable",
        workflow: REVIEW,
        reason: "Resource not accessible by integration (actions/runs)",
      }),
      1,
    );

    expect(outcome?.state).toBe("by-hand");
    expect(outcome?.detail).toContain("Resource not accessible by integration (actions/runs)");
    expect(outcome?.detail).toContain("actions: read");
    // Never a pass, and never a refusal for everyone: the merge is not blocked by it.
    expect(
      evaluateMergeGate({
        pr: orphan({
          state: "unreadable",
          workflow: REVIEW,
          reason: "Resource not accessible by integration (actions/runs)",
        }),
        powerDocs: ["PROTOCOL.md"],
      }).curatorMayMerge,
    ).toBe(true);
  });

  it("(д) a workflow_dispatch round does not anchor anything — it hangs on the head of the base", () => {
    const outcome = guard(
      orphan({
        state: "read",
        workflow: REVIEW,
        runs: [
          run({
            // A dispatch round of the reviewer: the run hangs on the head of `main`, and the
            // verdict it sends is shown against the PR's head all the same (thread 043 met
            // the same run from the other side).
            event: "workflow_dispatch",
            headSha: `aaaaaaaa${"0".repeat(32)}`,
            createdAt: "2026-08-21T22:50:00Z",
            updatedAt: "2026-08-21T22:55:00Z",
          }),
        ],
      }),
      1,
    );

    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("workflow_dispatch");
  });

  it("a round of ANOTHER workflow on this head anchors nothing — the name is the caller's", () => {
    const outcome = guard(
      orphan({
        state: "read",
        workflow: REVIEW,
        // `checks` was running on the new head at exactly the moment of the orphan verdict —
        // which is why "any run on the head" would have passed #347 and this door does not.
        runs: [
          run({
            id: 999,
            name: "checks",
            headSha: PUSHED_HEAD,
            createdAt: "2026-08-21T22:48:40Z",
            updatedAt: "2026-08-21T22:56:00Z",
          }),
        ],
      }),
      1,
    );

    expect(outcome?.state).toBe("fail");
    expect(outcome?.detail).toContain("no round of 'Claude PR Review' is reported");
  });

  it("nobody named the reviewer's workflow: by-hand, with the manual form of the check", () => {
    const outcome = guard(orphan(undefined), 1);

    expect(outcome?.state).toBe("by-hand");
    expect(outcome?.detail).toContain("--review-workflow");
    expect(outcome?.detail).toContain("actions/runs?head_sha=");
  });

  it("an approve with no stamp is 'cannot tell', not 'orphan' — by-hand, and the merge stands", () => {
    const facts = pr({
      headSha: PUSHED_HEAD,
      reviews: [{ state: "APPROVED", commitSha: PUSHED_HEAD, author: "github-actions" }],
      reviewRuns: { state: "read", workflow: REVIEW, runs: [run({ headSha: PUSHED_HEAD })] },
    });
    const outcome = guard(facts, 1);

    expect(outcome?.state).toBe("by-hand");
    expect(outcome?.detail).toContain("no 'submittedAt'");
  });

  it("a changes-requested still STOPS before the anchor is ever asked", () => {
    const outcome = guard(
      orphan({ state: "read", workflow: REVIEW, runs: [run({ headSha: PUSHED_HEAD })] }),
      1,
    );
    expect(outcome?.state).toBe("pass");

    const refused = guard(
      pr({
        headSha: PUSHED_HEAD,
        reviews: [
          {
            state: "CHANGES_REQUESTED",
            commitSha: PUSHED_HEAD,
            author: "github-actions",
            submittedAt: "2026-08-21T22:54:33Z",
          },
        ],
        reviewRuns: { state: "read", workflow: REVIEW, runs: [run({ headSha: PUSHED_HEAD })] },
      }),
      1,
    );

    expect(refused?.state).toBe("fail");
    expect(refused?.detail).toContain("changes were requested");
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
    expect(outcome?.detail).toContain("3 run(s) green");
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
    expect(outcome?.detail).toContain("2 run(s) green");
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

/**
 * THE HALF OF THREAD 040 THAT WORKS BEFORE THE DAEMON'S OWN REPAIR DOES. A merge that
 * moves `protocolVersion` is the only merge in this repository that leaves work on the
 * boxes, and it left it silently three times in a week — the gate is where a human is
 * already looking at the moment the button becomes available.
 */
describe("the follow-up a schema bump leaves on the boxes", () => {
  it("says it when the diff touches the config that carries the number", () => {
    const lines = describeVersionBumpFollowUp({
      changedPaths: ["packages/agent-protocol/src/cli.ts", "agent-protocol.json"],
      configPath: "agent-protocol.json",
    }).join("\n");
    expect(lines).toContain("protocolVersion");
    expect(lines).toContain("git pull --ff-only");
    expect(lines).toContain("systemctl --user restart");
    // The claim is what the gate KNOWS — the file was touched — and not a bump it never read.
    expect(lines).toContain("IF it moves");
  });

  it("is silent on a diff that leaves the config alone — a warning on every PR is noise", () => {
    expect(
      describeVersionBumpFollowUp({
        changedPaths: ["packages/agent-protocol/src/cli.ts", "docs/protocol-reference.md"],
        configPath: "agent-protocol.json",
      }),
    ).toEqual([]);
  });

  it("matches the config path however the caller spelled it", () => {
    expect(
      describeVersionBumpFollowUp({
        changedPaths: ["./agent-protocol.json"],
        configPath: "agent-protocol.json",
      }).length,
    ).toBe(2);
  });
});

/**
 * GUARD 2 OFF THE RUNS OF ACTIONS (thread 120). The five answers are five sentences, and
 * the reason each is its own case is that the previous shape had ONE — "not green" — for a
 * refused token, an unfinished round and a real failure alike.
 */
describe("checksOutcome — the outcome of the checks, and the reasons there is none", () => {
  const head = "0a612b27c151a53ae53eec27e240f04b7866fa87";
  const facts = (
    checks: PullRequestFacts["checks"],
    checkRuns?: PullRequestFacts["checkRuns"],
  ): PullRequestFacts => ({
    number: 1,
    headSha: head,
    body: "thread: 120-box-github-credentials",
    reviews: [],
    checks,
    checkRuns: checkRuns ?? { state: "read", runs: [] },
    changedPaths: [],
    mergeable: "MERGEABLE",
  });
  const run = (name: string, conclusion: string | undefined, status = "completed") => ({
    name,
    status,
    conclusion,
    state: undefined,
    completedAt: status === "completed" ? "2026-09-02T08:10:00Z" : undefined,
    startedAt: "2026-09-02T08:00:00Z",
  });

  it("REFUSES BY NAME when the source refused — never 'nothing confirmed this head'", () => {
    const outcome = checksOutcome(
      facts([], { state: "unreadable", reason: "HTTP 403: Resource not accessible" }),
    );

    expect(outcome.state).toBe("fail");
    expect(outcome.detail).toContain("HTTP 403: Resource not accessible");
    expect(outcome.detail).toContain("UNKNOWN");
  });

  it("says nobody asked when nobody asked — the scheduler's own state, not a fact about the head", () => {
    const outcome = checksOutcome(facts([], { state: "not-asked" }));

    expect(outcome.state).toBe("fail");
    expect(outcome.detail).toContain("not asked for");
  });

  it("green when every run that answered is green — and says the required list was not declared", () => {
    const outcome = checksOutcome(facts([run("CI", "success"), run("E2E", "success")]));

    expect(outcome.state).toBe("pass");
    expect(outcome.detail).toContain("NO REQUIRED LIST WAS DECLARED");
  });

  it("counts a skip as neither side — green is never the sum of skips", () => {
    const onlySkips = checksOutcome(
      facts([run("Notifier Watch", "skipped"), run("Notifier Watch 2", "skipped")]),
    );
    expect(onlySkips.state).toBe("fail");
    expect(onlySkips.detail).toContain("Green is never the sum of skips");

    // Beside a real success they are named and do not refuse — the live shape of `0a612b27`.
    const beside = checksOutcome(facts([run("CI", "success"), run("Notifier Watch", "skipped")]));
    expect(beside.state).toBe("pass");
    expect(beside.detail).toContain("skipped (neither side)");
  });

  it("tells 'still running' from 'not green' — one is a moment to come back to", () => {
    const outcome = checksOutcome(facts([run("CI", undefined, "in_progress")]));

    expect(outcome.state).toBe("fail");
    expect(outcome.detail).toContain("still running");
    expect(outcome.detail).not.toContain("not green");
  });

  it("fails on a required run that is missing, and on one that only skipped", () => {
    const missing = checksOutcome(facts([run("CI", "success")]), ["CI", "E2E"]);
    expect(missing.state).toBe("fail");
    expect(missing.detail).toContain("E2E");

    const skipped = checksOutcome(facts([run("CI", "success"), run("E2E", "skipped")]), [
      "CI",
      "E2E",
    ]);
    expect(skipped.state).toBe("fail");
    expect(skipped.detail).toContain("E2E");
  });

  it("passes on a head whose runs Actions answered about with an empty list? — no: that is 'no run reported'", () => {
    const outcome = checksOutcome(facts([]));

    expect(outcome.state).toBe("fail");
    expect(outcome.detail).toContain("no run of Actions reported");
  });

  it("credits the LAST attempt — a rerun that went green is green (D1 over the runs)", () => {
    const failed = { ...run("CI", "failure"), completedAt: "2026-09-02T08:05:00Z" };
    const rerun = { ...run("CI", "success"), completedAt: "2026-09-02T09:00:00Z" };

    expect(checksOutcome(facts([failed, rerun]), ["CI"]).state).toBe("pass");
  });

  it("reads the older vocabulary too — a hand-built fact in upper case is judged the same", () => {
    const outcome = checksOutcome(facts([{ ...run("CI", "SUCCESS"), status: "COMPLETED" }]), [
      "CI",
    ]);

    expect(outcome.state).toBe("pass");
  });
});
