import { describe, expect, it } from "vitest";
import { parkedThreads } from "./index-doc.js";
import type { Message } from "./message.js";
import {
  describeStaleRunPark,
  judgeRunPark,
  pendingRunsOf,
  RUN_PARK_TTL_SECONDS,
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
    expect(verdict.reason).toContain("gh pr checks 243");
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

describe("the door of a run: park — the round that is already over (thread 032)", () => {
  // THE LIVE RACE of 2026-08-23 (a consumer): the outcome of the round on #386 was committed at
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
    expect(verdict.reason).toContain("gh pr checks 386");
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
