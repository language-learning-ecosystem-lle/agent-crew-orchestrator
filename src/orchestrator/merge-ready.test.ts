/**
 * TIER 2 OF THE QUEUE — the thread that is holding a merge (thread `019-operator-ux`,
 * statement of work of 2026-08-01, point 5). Every acceptance fact of that statement is
 * a test here, in its own words, plus the one that carries the whole design: the door and
 * the scheduler answer the SAME head identically, because they call the same function.
 */
import { describe, expect, it } from "vitest";
import { evaluateMergeGate, type PullRequestFacts } from "../merge/gate.js";
import {
  createMergeReadyCache,
  type MergeReadySource,
  type OpenPullRequest,
  readMergeReady,
} from "./merge-ready.js";
import { describeOrder, orderCandidates, type RankedCandidate } from "./priority.js";
import { reviewRoundWord } from "./state-word.js";

const HEAD = "9d356944e57e416d99d8c32ff74aa6b1f5f4ae4f";
const HEAD_AT = "2026-08-01T05:00:00Z";

const facts = (over: Partial<PullRequestFacts> = {}): PullRequestFacts => ({
  number: 152,
  headSha: HEAD,
  body: "thread: 019-operator-ux\nrole: dev-core",
  headCommittedAt: HEAD_AT,
  reviews: [
    {
      state: "APPROVED",
      commitSha: HEAD,
      author: "github-actions",
      submittedAt: "2026-08-01T05:10:00Z",
    },
  ],
  checks: [
    {
      name: "checks",
      status: "COMPLETED",
      conclusion: "SUCCESS",
      state: undefined,
      completedAt: "2026-08-01T05:12:00Z",
    },
  ],
  changedPaths: ["packages/agent-protocol/src/cli.ts"],
  mergeable: "MERGEABLE",
  ...over,
});

const source = (input: {
  readonly open: readonly OpenPullRequest[] | (() => never);
  readonly facts?: (number: number) => PullRequestFacts;
  readonly reads?: number[];
}): MergeReadySource => ({
  open: async () => (typeof input.open === "function" ? input.open() : input.open),
  facts: async (number) => {
    input.reads?.push(number);
    return input.facts?.(number) ?? facts();
  },
});

const open = (over: Partial<OpenPullRequest> = {}): OpenPullRequest => ({
  number: 152,
  headSha: HEAD,
  body: "thread: 019-operator-ux",
  labels: [],
  ...over,
});

const candidate = (over: Partial<RankedCandidate> & { thread: string }): RankedCandidate => ({
  role: "dev-core",
  priority: "normal",
  ...over,
});

describe("readMergeReady — the fact is measured through the door's own guards", () => {
  it("an approve on the head and green checks on it: the thread is named, with its PR", async () => {
    const reading = await readMergeReady({
      source: source({ open: [open()] }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
    });
    expect([...reading.ready]).toEqual([["019-operator-ux", 152]]);
    expect(reading.notes.join("\n")).toContain("guards 1-2 hold on PR #152");
  });

  it("a verdict OLDER than the head commit gives no acceleration — the same answer the door gives", async () => {
    // Thread 043: a review submitted with no commit of its own is SHOWN against whatever
    // head the PR has now. The door refuses it; the queue must not accelerate it.
    const stale = facts({
      reviews: [
        {
          state: "APPROVED",
          commitSha: HEAD,
          author: "github-actions",
          submittedAt: "2026-08-01T04:00:00Z",
        },
      ],
    });
    const reading = await readMergeReady({
      source: source({ open: [open()], facts: () => stale }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
    });
    expect([...reading.ready]).toEqual([]);
    const door = evaluateMergeGate({ pr: stale, powerDocs: [] });
    expect(door.guards.find((guard) => guard.guard === 1)?.state).toBe("fail");
  });

  it("ONE definition of 'ready': every head the door passes on guards 1-2, the queue accelerates, and no other", async () => {
    const cases: readonly PullRequestFacts[] = [
      facts(),
      facts({ reviews: [] }),
      facts({
        checks: [
          { name: "checks", status: "IN_PROGRESS", conclusion: undefined, state: undefined },
        ],
      }),
      facts({ checks: [] }),
      facts({
        reviews: [
          {
            state: "CHANGES_REQUESTED",
            commitSha: HEAD,
            author: "github-actions",
            submittedAt: "2026-08-01T05:10:00Z",
          },
        ],
      }),
    ];
    for (const pr of cases) {
      const reading = await readMergeReady({
        source: source({ open: [open()], facts: () => pr }),
        threads: ["019-operator-ux"],
        cache: createMergeReadyCache(),
      });
      const door = evaluateMergeGate({ pr, powerDocs: [] });
      // "Holds" is "does not REFUSE" (thread 027): guard 1 answers `by-hand` whenever the
      // rounds of review were not read, and this reader never reads them — one Actions call
      // per pull request per tick, for a hint about the ORDER of a queue. Read as "not
      // ready", that state would switch the merge-ready acceleration off for every PR there
      // is; the obligation itself is answered at the door, which is what opens a merge.
      const doorHolds = door.guards
        .filter((guard) => guard.guard === 1 || guard.guard === 2)
        .every((guard) => guard.state !== "fail");
      expect(reading.ready.size > 0).toBe(doorHolds);
    }
  });

  it("a network that refuses accelerates NOBODY and slows NOBODY — one direction of degradation", async () => {
    const reading = await readMergeReady({
      source: source({
        open: () => {
          throw new Error("gh: could not resolve to a Repository");
        },
      }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
    });
    expect([...reading.ready]).toEqual([]);
    expect(reading.notes.join("\n")).toContain("exactly the queue without merge-ready");
  });

  it("a PR that cannot be read leaves its thread in its ordinary place, out loud", async () => {
    const reading = await readMergeReady({
      source: {
        open: async () => [open()],
        facts: async () => {
          throw new Error("HTTP 502");
        },
      },
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
    });
    expect([...reading.ready]).toEqual([]);
    expect(reading.notes.join("\n")).toContain("PR #152 (019-operator-ux) not read");
  });

  it("a head that has not moved is not asked about twice — the cache is keyed by (PR, head)", async () => {
    const reads: number[] = [];
    const cache = createMergeReadyCache();
    const gh = source({ open: [open()], reads });
    await readMergeReady({ source: gh, threads: ["019-operator-ux"], cache });
    await readMergeReady({ source: gh, threads: ["019-operator-ux"], cache });
    expect(reads).toEqual([152]);
    // A head that DID move is a different question and is asked again.
    await readMergeReady({
      source: source({ open: [open({ headSha: "0000000" })], reads }),
      threads: ["019-operator-ux"],
      cache,
    });
    expect(reads).toEqual([152, 152]);
  });

  it("'not ready yet' is not remembered: the same head is asked again and fires when the verdict lands", async () => {
    const reads: number[] = [];
    const cache = createMergeReadyCache();
    // The ordinary life of a pull request: it is opened, the first tick finds the checks
    // still flying, and the approve plus the green checks arrive on THE SAME head.
    let flying = true;
    const gh = source({
      open: [open()],
      reads,
      facts: () => (flying ? facts({ reviews: [] }) : facts()),
    });
    const first = await readMergeReady({ source: gh, threads: ["019-operator-ux"], cache });
    expect([...first.ready]).toEqual([]);
    flying = false;
    const second = await readMergeReady({ source: gh, threads: ["019-operator-ux"], cache });
    expect([...second.ready]).toEqual([["019-operator-ux", 152]]);
    expect(reads).toEqual([152, 152]);
  });

  it("a PR of a thread nobody is waiting on is never asked about — the price limit, not a nicety", async () => {
    const reads: number[] = [];
    const reading = await readMergeReady({
      source: source({ open: [open({ number: 3, body: "thread: 009-old" })], reads }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
    });
    expect(reads).toEqual([]);
    expect([...reading.ready]).toEqual([]);
  });

  it("a PR with no `thread:` line reorders nothing and is not reported — it is guard 3's defect", async () => {
    const reads: number[] = [];
    const reading = await readMergeReady({
      source: source({ open: [open({ body: "no thread line here" })], reads }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
    });
    expect(reads).toEqual([]);
    expect(reading.notes).toEqual([]);
  });
});

describe("the tier itself (orderCandidates)", () => {
  it("a thread holding a merge goes ahead of one that has waited longer", () => {
    const queue = orderCandidates([
      candidate({ thread: "023-parking", since: "2026-07-28T10:00:00Z" }),
      candidate({ thread: "019-operator-ux", since: "2026-08-01T05:00:00Z", mergeReadyPr: 152 }),
    ]);
    expect(queue.map((entry) => entry.thread)).toEqual(["019-operator-ux", "023-parking"]);
  });

  it("an explicit `priority: high` still outranks it — a computed fact does not overtake a person", () => {
    const queue = orderCandidates([
      candidate({ thread: "019-operator-ux", since: "2026-08-01T05:00:00Z", mergeReadyPr: 152 }),
      candidate({ thread: "047-something", priority: "high", since: "2026-08-01T05:30:00Z" }),
    ]);
    expect(queue.map((entry) => entry.thread)).toEqual(["047-something", "019-operator-ux"]);
  });

  it("with nothing measured the order is byte-for-byte the order of the three tiers", () => {
    const three = [
      candidate({ thread: "047-something", since: "2026-08-01T05:30:00Z" }),
      candidate({ thread: "023-parking", since: "2026-07-28T10:00:00Z" }),
      candidate({ thread: "009-old", priority: "low", since: "2026-07-01T10:00:00Z" }),
    ];
    expect(orderCandidates(three).map((entry) => entry.thread)).toEqual([
      "023-parking",
      "047-something",
      "009-old",
    ]);
  });

  it("two merge-ready threads fall through to the age of the wait, as before", () => {
    const queue = orderCandidates([
      candidate({ thread: "047-something", since: "2026-08-01T05:30:00Z", mergeReadyPr: 149 }),
      candidate({ thread: "019-operator-ux", since: "2026-08-01T05:00:00Z", mergeReadyPr: 152 }),
    ]);
    expect(queue.map((entry) => entry.thread)).toEqual(["019-operator-ux", "047-something"]);
  });
});

describe("the queue line (describeOrder)", () => {
  it("names the MEASURED fact — 'guards 1-2 hold', never the word 'merge-ready'", () => {
    // Point 2 of the statement of work: the line is read by a human who then presses
    // merge, and guards 3 and 5 are judgements this circuit never computes.
    const [line] = describeOrder(
      orderCandidates([
        candidate({ thread: "019-operator-ux", since: "2026-08-01T05:00:00Z", mergeReadyPr: 152 }),
      ]),
    );
    expect(line).toContain("guards 1-2 hold on PR #152");
    expect(line).not.toContain("merge-ready");
  });

  it("says nothing at all when nothing was measured", () => {
    const [line] = describeOrder(
      orderCandidates([candidate({ thread: "023-parking", since: "2026-07-28T10:00:00Z" })]),
    );
    expect(line).not.toContain("guards 1-2");
    expect(line).not.toContain("ROUND OF REVIEW");
  });

  it("the round of review is printed WHOLE, and it carries its own caveat (thread 063)", () => {
    // The line is asserted entire and not by a keyword: §11 of `docs/state-model.md` showed
    // that two different states can print one phrase, and that is only catchable by reading
    // the sentence a human is going to read.
    const [line] = describeOrder(
      orderCandidates([
        candidate({
          thread: "063-state-model-rewrite",
          since: "2026-09-03T10:00:00Z",
          reviewRoundPr: 240,
        }),
      ]),
    );

    expect(line).toBe(
      "queue 1/1: dev-core×063-state-model-rewrite — priority normal, waiting since 2026-09-03T10:00:00Z · ⏳ WAITING FOR A ROUND OF REVIEW — the label is on PR #240 and no verdict stands against the head it has now. Whether the round is still running or the label was left on a head that has since moved is NOT asked (that is an Actions call per pull request per tick) — if nothing has answered for long, look at the head before waiting further",
    );
  });

  it("the two tiers are never on one row: a ready PR is not also 'waiting for a round'", () => {
    // Held by construction in the reader (a thread in `ready` is deleted from `inReview`),
    // and asserted here on the words, because the row is where a reader would meet both.
    const [line] = describeOrder(
      orderCandidates([
        candidate({ thread: "019-operator-ux", since: "2026-08-01T05:00:00Z", mergeReadyPr: 152 }),
      ]),
    );

    expect(line).toContain("guards 1-2 hold on PR #152");
    expect(line).not.toContain("ROUND OF REVIEW");
  });
});

/**
 * WHAT THE RAISE IS FOR (thread `024-merge-ready-vs-power-docs`). The measured defect: the
 * line ended at "raised ahead of the ordinary queue" and was read as "raised in order to
 * press merge", on a pull request whose merge no raised role may perform at all — guard 4
 * of the door stops a diff touching a document of power at every one of them. The assert
 * bites the TEXT, on the curator's requirement: a note whose presence is checked and whose
 * words are not is exactly the note that promised the wrong thing for three weeks.
 */
describe("the note of the tier — the raise names its own purpose", () => {
  it("carries the two halves the frame was missing: whose the remaining guards are, and what the pair may do", async () => {
    const reading = await readMergeReady({
      source: source({ open: [open()] }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
    });
    const [line] = reading.notes;
    expect(line).toContain("guards 1-2 hold on PR #152");
    expect(line).toContain("Guards 3-5 stay with a human");
    expect(line).toContain("document of power is john's button, not the pair's");
    expect(line).toContain(
      "merge it if the remaining guards allow, otherwise park behind it or report",
    );
    // The old ending, verbatim — the sentence that stopped at the raise and let the reader
    // finish it with "…to press merge".
    expect(line).not.toContain("the pair is raised ahead of the ordinary queue");
  });

  it("ONE note for every pull request: a diff touching a document of power reads exactly like one that does not", async () => {
    const reading = async (changedPaths: readonly string[]) =>
      readMergeReady({
        source: source({ open: [open()], facts: () => facts({ changedPaths }) }),
        threads: ["019-operator-ux"],
        cache: createMergeReadyCache(),
      });
    // #48 of 2026-08-21 (the measured case) against an ordinary code PR.
    const power = await reading(["PROTOCOL.md"]);
    const ordinary = await reading(["packages/agent-protocol/src/cli.ts"]);
    expect(power.notes).toEqual(ordinary.notes);
    // AND THE ORDER IS NOT TOUCHED BY ANY OF IT — the map is the same map either way, which
    // is the whole of "the words change, the queue does not".
    expect([...power.ready]).toEqual([["019-operator-ux", 152]]);
    expect([...ordinary.ready]).toEqual([...power.ready]);
  });
});

/**
 * §5 STATE 2 OF `docs/state-model.md` — the pair that hung the label and passed the turn,
 * and which the frame called "finished". Four branches, and each of them is named here in
 * the words of the statement of work: the project that declared no round, the round that
 * is open, the round that closed with a verdict, and the label the reader deliberately
 * does NOT tell from a running round.
 */
describe("readMergeReady — the round of review, said where the pair read as finished", () => {
  /** Not ready: no verdict against the head at all, so only the label decides. */
  const unreviewed = facts({ reviews: [] });

  it("no 'review' in the config: the tier is SILENT and the ready half is bit for bit the same", async () => {
    const reading = await readMergeReady({
      source: source({ open: [open({ labels: ["review"] })], facts: () => unreviewed }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
    });

    // The label is right there on the PR and is still not read: a package that assumed the
    // word `review` would be inventing one contour's vocabulary for every other one.
    expect([...reading.inReview]).toEqual([]);
    expect([...reading.ready]).toEqual([]);
  });

  it("the label is on and nothing has answered this head: THE STATE, with its PR", async () => {
    const reading = await readMergeReady({
      source: source({ open: [open({ labels: ["review", "size/L"] })], facts: () => unreviewed }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
      reviewLabel: "review",
    });

    expect([...reading.inReview]).toEqual([["019-operator-ux", 152]]);
  });

  it("no label: not the state — a pull request nobody sent to review waits for its author", async () => {
    const reading = await readMergeReady({
      source: source({ open: [open({ labels: [] })], facts: () => unreviewed }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
      reviewLabel: "review",
    });

    expect([...reading.inReview]).toEqual([]);
  });

  it("the round CLOSED with a verdict on this head: not the state, and never both maps", async () => {
    // `facts()` carries an approve anchored to the head — guards 1-2 hold, the older tier
    // speaks, and what the pair waits for is a button, not a round.
    const reading = await readMergeReady({
      source: source({ open: [open({ labels: ["review"] })] }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
      reviewLabel: "review",
    });

    expect([...reading.ready]).toEqual([["019-operator-ux", 152]]);
    expect([...reading.inReview]).toEqual([]);
  });

  it("a verdict on this head that REFUSES: not the state either — the turn is the author's", async () => {
    // `CHANGES_REQUESTED` on the current head fails guard 1, so the thread is in neither
    // map: the round has answered, and the pair is not waiting for it.
    const answered = facts({
      reviews: [
        {
          state: "CHANGES_REQUESTED",
          commitSha: HEAD,
          author: "github-actions",
          submittedAt: "2026-08-01T05:10:00Z",
        },
      ],
    });
    const reading = await readMergeReady({
      source: source({ open: [open({ labels: ["review"] })], facts: () => answered }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
      reviewLabel: "review",
    });

    expect([...reading.ready]).toEqual([]);
    expect([...reading.inReview]).toEqual([]);
  });

  it("a label left on a head that has since moved is NOT told from a running round — and the line says so", async () => {
    // The third position of the statement of work (thread `053-review-bypassed`). Telling
    // it apart is a run of the reviewer's workflow anchored to this head — an Actions call
    // per pull request per tick, which this reader does not make. So it is reported as the
    // state, and the caveat travels IN THE WORDS rather than in a document nobody opens.
    const movedHead = facts({
      reviews: [
        {
          state: "APPROVED",
          commitSha: "0000000000000000000000000000000000000000",
          author: "github-actions",
          submittedAt: "2026-08-01T04:00:00Z",
        },
      ],
    });
    const reading = await readMergeReady({
      source: source({ open: [open({ labels: ["review"] })], facts: () => movedHead }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
      reviewLabel: "review",
    });

    expect([...reading.inReview]).toEqual([["019-operator-ux", 152]]);
    expect(reviewRoundWord(152)).toContain("NOT asked");
  });

  it("the tier going dark leaves BOTH halves empty — degradation runs in one direction only", async () => {
    const reading = await readMergeReady({
      source: source({
        open: () => {
          throw new Error("gh: HTTP 401");
        },
      }),
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
      reviewLabel: "review",
    });

    expect([...reading.ready]).toEqual([]);
    expect([...reading.inReview]).toEqual([]);
    expect(reading.refusal).toContain("401");
    expect(reading.asked).toBe(true);
  });

  it("a single PR that could not be read stays a note: the tier is not stood down and 'asked' holds", async () => {
    const reading = await readMergeReady({
      source: {
        open: async () => [open({ labels: ["review"] })],
        facts: async () => {
          throw new Error("gh: could not read PR");
        },
      },
      threads: ["019-operator-ux"],
      cache: createMergeReadyCache(),
      reviewLabel: "review",
    });

    expect([...reading.inReview]).toEqual([]);
    expect(reading.refusal).toBeUndefined();
    expect(reading.notes.join("\n")).toContain("keeps its ordinary place");
  });

  it("the ORDER of the queue is bit for bit the same with the state and without it", async () => {
    // The load-bearing half: this field is read to SAY a state, never to move a pair.
    // Moving one by it would hand a machine the `thread-priority` right.
    const rows: readonly RankedCandidate[] = [
      { role: "dev-core", thread: "071-other", priority: "normal", since: "2026-08-01" },
      { role: "dev-core", thread: "063-state", priority: "normal", since: "2026-08-02" },
    ];
    const withState = rows.map((row) =>
      row.thread === "063-state" ? { ...row, reviewRoundPr: 152 } : row,
    );

    expect(orderCandidates(withState).map((row) => row.thread)).toEqual(
      orderCandidates(rows).map((row) => row.thread),
    );
  });
});
