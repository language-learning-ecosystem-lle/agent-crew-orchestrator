/**
 * The conditions of acceptance for the READING half of 029 (thread 029-circuit-metrics),
 * each as a regression rather than a decoration: the specification of this command has
 * already been wrong five times on live data, and every one of those corrections changed
 * a DEFINITION, which is exactly what a test holds and prose does not.
 */

import { describe, expect, it } from "vitest";
import type { OrchestratorEvent } from "./journal.js";
import {
  foldEconomy,
  foldMetrics,
  foldReview,
  type MergeRecord,
  type MetricsInput,
  renderMetrics,
  type VerdictRecord,
} from "./metrics.js";

const released = (
  ts: string,
  reason: OrchestratorEvent extends never
    ? never
    : "completed" | "exited-without-handoff" | "quota-exhausted" | "timeout",
  extra: { role?: string; thread?: string; costUsd?: number; turns?: number; steps?: number } = {},
): OrchestratorEvent =>
  ({
    kind: "lease-released",
    ts,
    role: extra.role ?? "dev-core",
    thread: extra.thread ?? "029-circuit-metrics",
    reason,
    ...(extra.steps === undefined ? {} : { steps: extra.steps }),
    ...(extra.costUsd === undefined
      ? {}
      : { usage: { costUsd: extra.costUsd, turns: extra.turns ?? 0, durationSec: 60 } }),
  }) as OrchestratorEvent;

const acquired = (ts: string, extra: { role?: string; thread?: string } = {}): OrchestratorEvent =>
  ({
    kind: "lease-acquired",
    ts,
    role: extra.role ?? "dev-core",
    thread: extra.thread ?? "029-circuit-metrics",
    deadline: ts,
  }) as OrchestratorEvent;

const input = (over: Partial<MetricsInput> = {}): MetricsInput => ({
  events: [],
  verdicts: [],
  merges: [],
  ...over,
});

const verdict = (ts: string, pr: number | null, v: "approve" | "needs-fixes"): VerdictRecord => ({
  ts,
  pr,
  verdict: v,
});

const merged = (ts: string, pr: number): MergeRecord => ({ ts, pr });

describe("economics — currency and tokens are two columns", () => {
  it("sums only what carries a ledger, and cuts it by role, thread and day", () => {
    const economy = foldEconomy(
      input({
        events: [
          released("2026-07-30T10:00:00Z", "completed", { costUsd: 1.5, turns: 10 }),
          released("2026-07-31T10:00:00Z", "completed", {
            costUsd: 2.25,
            turns: 20,
            role: "curator",
            thread: "021-native-tasks",
          }),
        ],
      }),
    );
    expect(economy.priced).toEqual({ runs: 2, costUsd: 3.75, turns: 30, durationSec: 120 });
    expect(economy.byRole.map((r) => r.key)).toEqual(["curator", "dev-core"]);
    expect(economy.byDay.map((r) => r.key)).toEqual(["2026-07-30", "2026-07-31"]);
    expect(economy.byThread.find((r) => r.key === "021-native-tasks")?.costUsd).toBe(2.25);
  });

  it("a run with no ledger never contributes a cent, and says why tokens are not there", () => {
    const economy = foldEconomy(
      input({
        events: [
          acquired("2026-07-31T10:00:00Z"),
          released("2026-07-31T10:30:00Z", "quota-exhausted", { steps: 293 }),
        ],
      }),
    );
    expect(economy.priced.costUsd).toBe(0);
    expect(economy.priceless).toEqual([
      { reason: "quota-exhausted", runs: 1, steps: 293, wallClockSec: 1800 },
    ]);
    expect(economy.tokensNote).toContain("not a ledger");
  });
});

describe("boundaries of the data are printed, never silently dropped", () => {
  it("a release older than any stream is the pre-stream era, not a loss on the seam", () => {
    const economy = foldEconomy(
      input({
        streamEraStart: "2026-07-25T16:29:42Z",
        events: [released("2026-07-24T22:58:00Z", "completed")],
      }),
    );
    expect(economy.preStreamEra).toEqual({
      runs: 1,
      from: "2026-07-24T22:58:00Z",
      to: "2026-07-24T22:58:00Z",
      roles: ["dev-core"],
    });
    expect(economy.blockAbsentAfterEra).toBeUndefined();
  });

  it("absence INSIDE the era is its own named row with a window and roles — and is not judged by the timestamp", () => {
    const economy = foldEconomy(
      input({
        streamEraStart: "2026-07-25T16:29:42Z",
        events: [
          released("2026-07-31T08:00:00Z", "completed"),
          released("2026-07-31T09:00:00Z", "exited-without-handoff", { role: "curator" }),
        ],
      }),
    );
    expect(economy.blockAbsentAfterEra).toEqual({
      runs: 2,
      from: "2026-07-31T08:00:00Z",
      to: "2026-07-31T09:00:00Z",
      roles: ["curator", "dev-core"],
    });
    const printed = renderMetrics({
      economy,
      review: foldReview(input()),
    });
    const row = printed.find((line) => line.startsWith("no usage block after the era began"));
    expect(row).toBeDefined();
    expect(row).toContain("not called a loss");
  });
});

describe("review rounds", () => {
  it("green first submission is the FIRST verdict, not the ONLY one", () => {
    // #74: approve, then a second approve on a new head after a rebase.
    const review = foldReview(
      input({
        verdicts: [
          verdict("2026-07-29T15:45:00Z", 74, "approve"),
          verdict("2026-07-29T23:10:00Z", 74, "approve"),
        ],
      }),
    );
    expect(review.greenFirstSubmission).toBe(1);
    expect(review.measuredPrs).toEqual([74]);
  });

  it("a round after needs-fixes and a round after approve go to different columns", () => {
    const review = foldReview(
      input({
        verdicts: [
          verdict("2026-07-29T10:00:00Z", 81, "needs-fixes"),
          verdict("2026-07-29T12:00:00Z", 81, "approve"),
          verdict("2026-07-29T15:45:00Z", 82, "approve"),
          verdict("2026-07-29T23:10:00Z", 82, "approve"),
        ],
      }),
    );
    expect(review.firstRounds).toBe(2);
    expect(review.redoRounds).toBe(1);
    expect(review.reconfirmRounds).toBe(1);
    const line = renderMetrics(
      foldMetrics(
        input({
          verdicts: [
            verdict("2026-07-29T15:45:00Z", 82, "approve"),
            verdict("2026-07-29T23:10:00Z", 82, "approve"),
          ],
        }),
      ),
    ).find((l) => l.startsWith("review rounds since"));
    expect(line).toContain("the price of the chosen discipline");
  });

  it("a PR whose first verdict may be older than the anchor enters NEITHER numerator nor denominator", () => {
    const review = foldReview(
      input({
        // #75 (the anchor itself) merged before the era began, so #62 already existed
        // then and its first verdict is not the one we can see; #79 was opened after.
        merges: [merged("2026-07-29T09:31:19Z", 75)],
        verdicts: [
          verdict("2026-07-29T09:53:38Z", 79, "approve"),
          verdict("2026-07-29T12:56:00Z", 62, "approve"),
          verdict("2026-07-29T14:22:00Z", 62, "approve"),
        ],
      }),
    );
    expect(review.partiallyAnchored).toEqual([62]);
    expect(review.measuredPrs).toEqual([79]);
    expect(review.greenFirstSubmission).toBe(1);
    // The rounds of a partially anchored PR still count — what it may not do is claim
    // a green first submission it cannot prove.
    expect(review.reconfirmRounds).toBe(1);
  });

  it("verdicts from before the anchor are counted and left unattributed", () => {
    const review = foldReview(
      input({
        verdicts: [
          verdict("2026-07-29T08:18:00Z", null, "approve"),
          verdict("2026-07-29T08:27:00Z", null, "needs-fixes"),
          verdict("2026-07-29T09:53:38Z", 79, "approve"),
        ],
      }),
    );
    expect(review.unanchored).toBe(2);
    expect(review.anchorFrom).toBe("2026-07-29T09:53:38Z");
    expect(review.measuredPrs).toEqual([79]);
  });
});

describe("the machine view carries every boundary as a FIELD, not as a footnote", () => {
  it("--json has the partially anchored row, the priceless class and both era rows", () => {
    const metrics = foldMetrics(
      input({
        streamEraStart: "2026-07-25T16:29:42Z",
        merges: [merged("2026-07-29T09:31:19Z", 75)],
        events: [
          released("2026-07-24T22:58:00Z", "completed"),
          released("2026-07-31T08:00:00Z", "completed"),
          released("2026-07-31T09:00:00Z", "quota-exhausted"),
          released("2026-07-31T10:00:00Z", "completed", { costUsd: 4.2, turns: 33 }),
        ],
        verdicts: [
          verdict("2026-07-29T09:53:38Z", 79, "approve"),
          verdict("2026-07-29T12:56:00Z", 62, "approve"),
        ],
      }),
    );
    const json = JSON.parse(JSON.stringify(metrics));
    expect(json.review.partiallyAnchored).toEqual([62]);
    expect(json.economy.preStreamEra.runs).toBe(1);
    expect(json.economy.blockAbsentAfterEra.runs).toBe(1);
    expect(json.economy.priceless[0].reason).toBe("quota-exhausted");
    expect(json.economy.tokensNote).toContain("not a ledger");
    expect(json.economy.priced.costUsd).toBe(4.2);
  });
});

describe("the fold is a READER — nothing here decides anything", () => {
  it("filters by role, thread and window without touching the events it was given", () => {
    const events = [
      released("2026-07-30T10:00:00Z", "completed", { costUsd: 1, role: "curator" }),
      released("2026-07-31T10:00:00Z", "completed", { costUsd: 2 }),
    ];
    const frozen = JSON.stringify(events);
    expect(foldEconomy(input({ events, role: "dev-core" })).priced.costUsd).toBe(2);
    expect(foldEconomy(input({ events, since: "2026-07-31T00:00:00Z" })).priced.runs).toBe(1);
    expect(foldEconomy(input({ events, thread: "029-circuit-metrics" })).priced.runs).toBe(2);
    expect(JSON.stringify(events)).toBe(frozen);
  });
});
