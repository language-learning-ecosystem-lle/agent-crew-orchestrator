import { describe, expect, it } from "vitest";
import { createMergeReadyCache, readMergeReady } from "./merge-ready.js";
import {
  describeGhOutage,
  foldGhOutage,
  GH_OUTAGE_TICKS,
  type GhOutage,
  ghAlarmDue,
  parseGhOutage,
  renderGhOutage,
} from "./outage.js";
import { rankCandidates } from "./priority.js";

const at = (minute: number): Date =>
  new Date(`2026-08-01T10:${String(minute).padStart(2, "0")}:00Z`);
const REFUSAL = "Could not resolve to a Repository with the name 'owner/repo'.";

describe("the run of gh refusals", () => {
  it("counts consecutive refusals with the same text as ONE outage", () => {
    let outage = foldGhOutage({ previous: undefined, refusal: REFUSAL, asked: true, now: at(1) });
    outage = foldGhOutage({ previous: outage, refusal: REFUSAL, asked: true, now: at(2) });
    outage = foldGhOutage({ previous: outage, refusal: REFUSAL, asked: true, now: at(3) });
    expect(outage).toMatchObject({
      ticks: 3,
      since: "2026-08-01T10:01:00Z",
      last: "2026-08-01T10:03:00Z",
    });
    expect(outage?.evidence).toBe(REFUSAL);
  });

  it("ends the run the moment the tier answers", () => {
    const first = foldGhOutage({ previous: undefined, refusal: REFUSAL, asked: true, now: at(1) });
    expect(
      foldGhOutage({ previous: first, refusal: undefined, asked: true, now: at(2) }),
    ).toBeUndefined();
  });

  it("starts a NEW run when the refusal changes: a different message is a different fault", () => {
    const first = foldGhOutage({ previous: undefined, refusal: REFUSAL, asked: true, now: at(1) });
    const second = foldGhOutage({
      previous: first,
      refusal: "gh: HTTP 401 Bad credentials",
      asked: true,
      now: at(2),
    });
    expect(second).toMatchObject({ ticks: 1, since: "2026-08-01T10:02:00Z" });
  });

  it("rings only past the threshold, and says the threshold beside the count", () => {
    let outage = foldGhOutage({ previous: undefined, refusal: REFUSAL, asked: true, now: at(1) });
    for (let tick = 2; tick < GH_OUTAGE_TICKS + 1; tick += 1) {
      expect(ghAlarmDue(outage as NonNullable<typeof outage>)).toBe(false);
      outage = foldGhOutage({ previous: outage, refusal: REFUSAL, asked: true, now: at(tick) });
    }
    const due = outage as NonNullable<typeof outage>;
    expect(due.ticks).toBe(GH_OUTAGE_TICKS);
    expect(ghAlarmDue(due)).toBe(true);
    expect(describeGhOutage(due)).toContain(`rings at ${GH_OUTAGE_TICKS}`);
    // THE VENDOR'S OWN SENTENCE, never a guess at what it means (#108/#109/#112).
    expect(describeGhOutage(due)).toContain(REFUSAL);
  });

  it("HOLDS the run on a tick that asked nobody — a lull is not an answer", () => {
    let outage = foldGhOutage({ previous: undefined, refusal: REFUSAL, asked: true, now: at(1) });
    outage = foldGhOutage({ previous: outage, refusal: REFUSAL, asked: true, now: at(2) });
    // Two quiet ticks: no candidates, so nothing was asked and nothing was answered.
    outage = foldGhOutage({ previous: outage, refusal: undefined, asked: false, now: at(3) });
    outage = foldGhOutage({ previous: outage, refusal: undefined, asked: false, now: at(4) });
    expect(outage).toMatchObject({ ticks: 2, since: "2026-08-01T10:01:00Z" });
    // …and the run continues where it stood: an outage that never stopped still rings.
    for (let tick = 5; tick <= 7; tick += 1)
      outage = foldGhOutage({ previous: outage, refusal: REFUSAL, asked: true, now: at(tick) });
    expect(outage).toMatchObject({ ticks: GH_OUTAGE_TICKS, since: "2026-08-01T10:01:00Z" });
    expect(ghAlarmDue(outage as NonNullable<typeof outage>)).toBe(true);
  });

  it("a tick with no candidates does not ASK, and says so", async () => {
    const cache = createMergeReadyCache();
    const source = {
      open: () => Promise.reject(new Error("gh must not be called with nothing to ask about")),
      facts: () => Promise.reject(new Error("never asked")),
    };
    const reading = await readMergeReady({ source, threads: [], cache });
    expect(reading.asked).toBe(false);
    expect(reading.refusal).toBeUndefined();
    expect(
      foldGhOutage({ previous: undefined, refusal: undefined, asked: false, now: at(1) }),
    ).toBe(undefined);
  });

  it("survives the file: what the daemon writes is what the courier reads", () => {
    const outage = foldGhOutage({ previous: undefined, refusal: REFUSAL, asked: true, now: at(1) });
    expect(parseGhOutage(renderGhOutage(outage))).toEqual(outage);
  });

  it("reads a missing or corrupt state file as NO outage — the alarm may only stay quiet", () => {
    expect(parseGhOutage("")).toBeUndefined();
    expect(parseGhOutage("{not json")).toBeUndefined();
    expect(parseGhOutage('{"evidence":"x"}')).toBeUndefined();
    expect(renderGhOutage(undefined)).toBe("");
  });
});

describe("fail-open is untouched by watching the tier", () => {
  const message = (waitingOn: string, at: string) => ({
    fields: { from: "curator", "waiting-on": waitingOn, at },
    at,
    body: "",
  });
  const threads = [
    { id: "010-a", messages: [message("dev-core", "2026-08-01T09:00:00Z")] },
    { id: "020-b", messages: [message("dev-core", "2026-08-01T08:00:00Z")] },
  ];
  const rank = (mergeReady: ReadonlyMap<string, number>) =>
    rankCandidates({
      threads: threads as never,
      roles: ["dev-core"],
      waitingOn: () => ["010-a", "020-b"],
      authorized: () => true,
      mergeReady,
    }).ranked.map((candidate) => candidate.thread);

  it("a repeated refusal reports the fact and orders the queue exactly as a circuit without the tier", async () => {
    const cache = createMergeReadyCache();
    const source = {
      open: () => Promise.reject(new Error(REFUSAL)),
      facts: () => Promise.reject(new Error("never asked")),
    };
    let outage: GhOutage | undefined;
    for (let tick = 1; tick <= GH_OUTAGE_TICKS + 2; tick += 1) {
      const reading = await readMergeReady({ source, threads: ["010-a", "020-b"], cache });
      // Empty map, the refusal quoted verbatim, and NOTHING thrown — every tick.
      expect(reading.ready.size).toBe(0);
      expect(reading.refusal).toBe(REFUSAL);
      outage = foldGhOutage({
        previous: outage,
        refusal: reading.refusal,
        asked: reading.asked,
        now: at(tick),
      });
      expect(rank(reading.ready)).toEqual(rank(new Map()));
    }
    expect(ghAlarmDue(outage as NonNullable<typeof outage>)).toBe(true);
  });
});
