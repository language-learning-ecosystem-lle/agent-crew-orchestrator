import { describe, expect, it } from "vitest";
import { parkedThreads } from "./index-doc.js";
import type { Message } from "./message.js";
import {
  describeStaleRunPark,
  judgeRunPark,
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
      facts: { headSha: "6f933b0321ab", mergeable: "MERGEABLE", checkRuns: 3 },
    });

    expect(verdict.ok).toBe(true);
  });

  // THE LIVE CASE of 2026-08-08: head `6f933b032` of #243 carried no run at all, and the pair
  // stood 2h10m waiting for a message whose author was never born.
  it("refuses a park on a head with no runs, and names the head and the way to check", () => {
    const verdict = judgeRunPark({
      pr: 243,
      facts: { headSha: "6f933b0321ab", mergeable: "MERGEABLE", checkRuns: 0 },
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
      facts: { headSha: "6f933b0321ab", mergeable: "CONFLICTING", checkRuns: 0 },
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
