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
