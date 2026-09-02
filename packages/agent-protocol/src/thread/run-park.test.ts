import { describe, expect, it } from "vitest";
import { parkedThreads } from "./index-doc.js";
import type { Message } from "./message.js";
import {
  describeStaleRunPark,
  judgeRunPark,
  looksLikeAbsentPr,
  pendingRunsOf,
  RUN_PARK_TTL_SECONDS,
  runsOnHead,
  staleRunParks,
} from "./run-park.js";
import type { Thread } from "./thread.js";

const message = (fields: Partial<Message["fields"]>, text = "Жду CI по #243."): Message => ({
  fields: {
    from: "dev-core",
    date: "2026-08-08T15:03:00Z",
    expects: "none",
    ...fields,
  } as Message["fields"],
  text,
});

const thread = (messages: readonly Message[], id = "062-park-without-a-run"): Thread => ({
  id,
  meta: {
    title: "Парковка на прогоне, которого нет",
    participants: ["curator", "dev-core"],
    status: "open",
  },
  messages,
});

describe("the door of a run: park (thread 062, layer 1)", () => {
  it("lets the park stand when a run exists on the head", () => {
    const verdict = judgeRunPark({
      pr: 243,
      facts: { headSha: "6f933b0321ab", mergeable: "MERGEABLE", checkRuns: 3, pendingRuns: 1 },
    });

    expect(verdict.ok).toBe(true);
  });

  // THE LIVE CASE of 2026-08-08: head `6f933b032` of #243 carried no run at all, and the pair
  // stood 2h10m waiting for a message whose author was never born.
  it("refuses a park on a head with no runs, and names the head and the way to check", () => {
    const verdict = judgeRunPark({
      pr: 243,
      facts: { headSha: "6f933b0321ab", mergeable: "MERGEABLE", checkRuns: 0, pendingRuns: 0 },
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("not one run on head 6f933b03");
    // THE COMMAND IT HANDS OUT IS ONE THE READER CAN ACTUALLY RUN (thread 120): `gh pr checks`
    // reads `statusCheckRollup`, a Checks resource no fine-grained token is ever granted, so
    // the old wording sent a role to a 403 to check the door's word.
    expect(verdict.reason).toContain("actions/runs?head_sha=6f933b0321ab");
    expect(verdict.reason).not.toContain("gh pr checks");
  });

  // The CAUSE of that head having no runs, said apart because it is repaired differently.
  it("refuses a park on a CONFLICTING pull request by its own name", () => {
    const verdict = judgeRunPark({
      pr: 243,
      facts: { headSha: "6f933b0321ab", mergeable: "CONFLICTING", checkRuns: 0, pendingRuns: 0 },
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("CONFLICTING");
    expect(verdict.reason).toContain("NO RUN WILL BE BORN");
  });

  it("does NOT refuse when gh could not be asked — it says so and leans on the ceiling", () => {
    const verdict = judgeRunPark({ pr: 243, refusal: "gh: no token" });

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.note).toContain("NOT verified");
    expect(verdict.note).toContain("gh: no token");
  });
});

/**
 * TWO SOURCES CAN REFUSE APART (thread 120) — the door reads the head from `gh pr view` and the
 * runs from `actions/runs`, and a token can hold the first while being refused the second. That
 * is not a hypothesis: it is the shape of the box this circuit runs on, where the Checks
 * resource is unreachable by construction.
 */
describe("the door of a run: park — the runs that were not read (thread 120)", () => {
  it("lets the park stand when the PR was read and its runs were not, quoting the refusal", () => {
    const verdict = judgeRunPark({
      pr: 181,
      facts: {
        headSha: "147905ee109",
        mergeable: "MERGEABLE",
        runsRefusal: "HTTP 403: Resource not accessible by personal access token",
      },
    });

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.note).toContain("were NOT read");
    expect(verdict.note).toContain("147905ee1");
    expect(verdict.note).toContain("Resource not accessible");
  });

  // AN UNREAD SOURCE IS NOT AN EMPTY ONE. Reading absent counts as "no runs on this head" would
  // refuse every park on a box whose token cannot see Actions — a door that says no to everyone
  // is the same silence as a door that says nothing, only louder.
  it("never reads unread runs as zero runs", () => {
    const verdict = judgeRunPark({
      pr: 181,
      facts: { headSha: "147905ee109", mergeable: "MERGEABLE" },
    });

    expect(verdict.ok).toBe(true);
  });

  // The first source still judges what it alone can judge: a conflicting PR gets no merge ref
  // and therefore no run, whatever Actions did or did not answer.
  it("still refuses a CONFLICTING pull request when the runs are unreadable", () => {
    const verdict = judgeRunPark({
      pr: 181,
      facts: { headSha: "147905ee109", mergeable: "CONFLICTING", runsRefusal: "HTTP 403" },
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("NO RUN WILL BE BORN");
  });
});

describe("the runs of THIS head (thread 120)", () => {
  const runs = [
    { headSha: "147905EE109", status: "completed" },
    { headSha: "147905ee109", status: "in_progress" },
    { headSha: "0a612b27c15", status: "queued" },
    { status: "in_progress" },
  ];

  // The anchor is enforced on the ANSWER, not only in the query: `actions/runs` is asked with
  // the head in the URL, but the payload is somebody else's and this circuit has twice paid for
  // an outcome read off another slice of the repository.
  it("keeps the runs of the head whatever the case of the sha, and drops every other", () => {
    expect(runsOnHead(runs, "147905ee109")).toHaveLength(2);
    expect(runsOnHead(runs, "0a612b27c15")).toHaveLength(1);
    expect(runsOnHead(runs, "deadbeef000")).toHaveLength(0);
  });

  // A run that names no head anchors nothing, and "unanchored" cannot be the evidence that
  // there is something to wait for — so it is dropped, towards refusing the park.
  it("drops a run that names no head at all", () => {
    expect(runsOnHead([{ status: "in_progress" }], "147905ee109")).toHaveLength(0);
  });

  // The vocabulary moved from GraphQL's `COMPLETED` to REST's `completed`, and the counter did
  // not have to: it has always case-folded. Both words are read here so the move is a test.
  it("counts what is still in flight in the vocabulary of Actions and of the old rollup alike", () => {
    expect(pendingRunsOf(runsOnHead(runs, "147905ee109"))).toBe(1);
    expect(pendingRunsOf([{ status: "COMPLETED" }, { status: "queued" }])).toBe(1);
  });
});

// THREAD 061, msg-002 — the OTHER thing `gh` can say, and the one sentence of its that is a fact
// about the world rather than a blink of the network.
describe("the door of a run: park — the pull request that is not there (thread 061)", () => {
  it("refuses when gh says there is no such pull request, and names where it asked", () => {
    const verdict = judgeRunPark({ pr: 33328290131, absent: { where: "/srv/repo" } });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("THERE IS NO PULL REQUEST #33328290131");
    expect(verdict.reason).toContain("/srv/repo");
    // The form wants the number of a PR, and the refusal says so — the whole confusion is that
    // `run:` reads as "an id of a run".
    expect(verdict.reason).toContain("NUMBER OF A PULL REQUEST");
  });

  it("reads that sentence out of gh's own words, and out of nothing else", () => {
    expect(
      looksLikeAbsentPr(
        "GraphQL: Could not resolve to a PullRequest with the number of 33328290131. (repository.pullRequest)",
      ),
    ).toBe(true);
    expect(looksLikeAbsentPr('no pull requests found for branch "feature/x"')).toBe(true);
    // NOT this: a missing token, a missing binary, a repository gh cannot see. Those must keep
    // leaving the park standing — a network that blinks may not cost a role its turn.
    expect(looksLikeAbsentPr("gh: no token")).toBe(false);
    expect(looksLikeAbsentPr("Could not resolve to a Repository with the name 'x/y'")).toBe(false);
    expect(looksLikeAbsentPr("gh: command not found")).toBe(false);
  });
});

describe("the door of a run: park — the round that is already over (thread 032)", () => {
  // THE LIVE RACE of 2026-08-23 (LLE): the outcome of the round on #386 was committed at
  // 05:41:46Z, the letter parking on `run:386` twenty seconds later — the condition lay in the
  // feed BEHIND the park, the lift looks forward only, and the pair slept until a human woke it.
  it("refuses a park whose round has already finished, and says the outcome is behind it", () => {
    const verdict = judgeRunPark({
      pr: 386,
      facts: { headSha: "64b331d7ee0", mergeable: "MERGEABLE", checkRuns: 2, pendingRuns: 0 },
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("ALREADY FINISHED");
    expect(verdict.reason).toContain("64b331d7e");
    expect(verdict.reason).toContain("BEHIND the park");
    expect(verdict.reason).toContain("actions/runs?head_sha=64b331d7ee0");
    expect(verdict.reason).not.toContain("gh pr checks");
  });

  // The regression of the class: a round IN FLIGHT is what the form is for, and it is not
  // touched. The note says which of the runs is the one being waited for.
  it("lets the park stand while one of the runs is still in flight", () => {
    const verdict = judgeRunPark({
      pr: 386,
      facts: { headSha: "64b331d7ee0", mergeable: "MERGEABLE", checkRuns: 3, pendingRuns: 1 },
    });

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.note).toContain("1 of 3");
  });

  // The refusal of the empty head keeps its own words: nothing has been born there, which is
  // repaired by waiting, while a finished round is repaired by reading its outcome.
  it("tells an empty head from a finished round — the two refusals are not one sentence", () => {
    const empty = judgeRunPark({
      pr: 386,
      facts: { headSha: "64b331d7ee0", mergeable: "MERGEABLE", checkRuns: 0, pendingRuns: 0 },
    });

    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.reason).toContain("not one run on head");
    expect(empty.reason).not.toContain("ALREADY FINISHED");
  });

  it("counts a check run by its status and a status context by its state", () => {
    expect(
      pendingRunsOf([
        { status: "COMPLETED", state: null },
        { status: "IN_PROGRESS", state: null },
        { status: "QUEUED", state: null },
        { state: "PENDING" },
        { state: "SUCCESS" },
      ]),
    ).toBe(3);
  });

  // The direction of the doubt, and it is the one the door can afford: an entry this reading
  // does not understand counts as FINISHED, so a payload that grew a shape refuses a park
  // loudly instead of letting a dead one through silently.
  it("counts an entry it cannot read as finished, never as pending", () => {
    expect(pendingRunsOf([{}, { status: "", state: "" }, { status: null, state: null }])).toBe(0);
  });
});

describe("the age ceiling of a run: park (thread 062, layer 2)", () => {
  const parked = thread([
    message({ parkedOn: "run:243", date: "2026-08-08T15:03:00Z", expects: "none" }),
  ]);

  it("says nothing while the park is younger than the ceiling", () => {
    expect(staleRunParks([parked], { now: new Date("2026-08-08T15:20:00Z") })).toEqual([]);
    expect(parkedThreads([parked], { now: new Date("2026-08-08T15:20:00Z") })).toEqual(
      new Map([["062-park-without-a-run", "run:243"]]),
    );
  });

  it("lifts the park past the ceiling — the pair stops being frozen and is raised", () => {
    const now = new Date("2026-08-08T17:15:00Z");
    const stale = staleRunParks([parked], { now });

    const first = stale[0];
    expect(stale).toHaveLength(1);
    expect(first?.pr).toBe(243);
    expect(first?.ageSeconds).toBe(132 * 60);
    expect(first === undefined ? "" : describeStaleRunPark(first)).toContain("HAS GONE STALE");
    // The map the tick plans by no longer holds it: that IS the raise.
    expect(parkedThreads([parked], { now })).toEqual(new Map());
  });

  it("the default ceiling is 3x the measured median of checks on this pool", () => {
    expect(RUN_PARK_TTL_SECONDS).toBe(30 * 60);
  });

  it("a ttl of zero switches the ceiling off — it does not make everything stale", () => {
    const now = new Date("2026-08-09T00:00:00Z");

    expect(staleRunParks([parked], { now, ttlSeconds: 0 })).toEqual([]);
    expect(parkedThreads([parked], { now, ttlSeconds: 0 })).toEqual(
      new Map([["062-park-without-a-run", "run:243"]]),
    );
  });

  // Only the machine event is aged. A human thinks for as long as they think, and a merge
  // button legitimately waits for days.
  it("ages neither a person park nor a pr: park", () => {
    const now = new Date("2026-08-09T00:00:00Z");
    const person = thread([message({ parkedOn: "john", expects: "answer" })], "070-person");
    const merge = thread([message({ parkedOn: "pr:243" })], "071-merge");

    expect(staleRunParks([person, merge], { now })).toEqual([]);
    expect(parkedThreads([person, merge], { now }).size).toBe(2);
  });
});
