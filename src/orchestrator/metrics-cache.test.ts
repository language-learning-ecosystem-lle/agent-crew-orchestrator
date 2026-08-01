/**
 * THE LAZY RECOVERY OF PRE-BLOCK HISTORY (thread 029, msg-003 §2).
 *
 * What is asserted here is not "the number came out right" but the three properties the
 * cache exists for: a stream is read ONCE, a stream with nothing in it is remembered as
 * such (otherwise the useless files are the ones re-read forever), and a stream that has
 * grown since it was remembered is read again.
 *
 * The runs that were KILLED are checked too, in the other direction: they must stay
 * priceless. Their per-message tokens do not add up to a ledger (`runUsageOf`), and a
 * recovery that quietly priced them would be the exact defect the whole two-column rule
 * of `metrics.ts` was written against.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { OrchestratorEvent } from "./journal.js";
import { hydrateFromStreams } from "./metrics-cache.js";

const acquired = (ts: string, role: string, thread: string): OrchestratorEvent =>
  ({ kind: "lease-acquired", ts, role, thread, deadline: ts }) as OrchestratorEvent;

const released = (
  ts: string,
  role: string,
  thread: string,
  reason = "completed",
): OrchestratorEvent => ({ kind: "lease-released", ts, role, thread, reason }) as OrchestratorEvent;

const RESULT = (cost: number, turns: number): string =>
  `${JSON.stringify({
    type: "result",
    subtype: "success",
    num_turns: turns,
    duration_ms: 60_000,
    total_cost_usd: cost,
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
  })}\n`;

const STEP = `${JSON.stringify({ type: "assistant", message: { content: "working" } })}\n`;

type Box = { readonly sessions: string; readonly cache: string };

const box = (): Box => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-metrics-cache-"));
  const sessions = join(base, "sessions");
  mkdirSync(sessions, { recursive: true });
  return { sessions, cache: join(base, "metrics.cache.jsonl") };
};

const stream = (at: Box, name: string, body: string): string => {
  const path = join(at.sessions, name);
  writeFileSync(path, body);
  return path;
};

const priceOf = (events: readonly OrchestratorEvent[]): (number | undefined)[] =>
  events
    .filter(
      (e): e is Extract<OrchestratorEvent, { kind: "lease-released" }> =>
        e.kind === "lease-released",
    )
    .map((e) => e.usage?.costUsd);

describe("the ledger of a run older than the usage block", () => {
  const RUN = [
    acquired("2026-07-26T10:00:00Z", "dev-core", "016-sync"),
    released("2026-07-26T11:00:00Z", "dev-core", "016-sync"),
  ];

  it("is read out of the run's own stream and priced", () => {
    const at = box();
    stream(at, "2026-07-26T10-00-05Z-dev-core-016-sync.jsonl", `${STEP}${RESULT(4.5, 40)}`);

    const { events, recovery } = hydrateFromStreams({ events: RUN, ...at });

    expect(priceOf(events)).toEqual([4.5]);
    expect(recovery).toEqual({ recovered: 1, parsed: 1, cached: 0, unresolved: 0 });
  });

  it("is read ONCE — the second call answers out of the cache without opening the file", () => {
    const at = box();
    const path = stream(at, "2026-07-26T10-00-05Z-dev-core-016-sync.jsonl", RESULT(4.5, 40));

    hydrateFromStreams({ events: RUN, ...at });
    // The file is emptied behind the cache's back: anything the second call still knows
    // it knows from the cache, and nothing else.
    writeFileSync(path, RESULT(4.5, 40));
    const second = hydrateFromStreams({ events: RUN, ...at });

    expect(priceOf(second.events)).toEqual([4.5]);
    expect(second.recovery).toEqual({ recovered: 1, parsed: 0, cached: 1, unresolved: 0 });
  });

  it("is read again when the stream has grown since — the key is name PLUS size", () => {
    const at = box();
    const name = "2026-07-26T10-00-05Z-dev-core-016-sync.jsonl";
    stream(at, name, STEP);
    const first = hydrateFromStreams({ events: RUN, ...at });
    expect(first.recovery).toEqual({ recovered: 0, parsed: 1, cached: 0, unresolved: 1 });

    // The run finished after the first call and wrote its result line.
    stream(at, name, `${STEP}${RESULT(2.25, 12)}`);
    const second = hydrateFromStreams({ events: RUN, ...at });

    expect(priceOf(second.events)).toEqual([2.25]);
    expect(second.recovery).toEqual({ recovered: 1, parsed: 1, cached: 0, unresolved: 0 });
  });

  it("a stream with no result line is remembered as a miss, not as unread", () => {
    const at = box();
    stream(at, "2026-07-26T10-00-05Z-dev-core-016-sync.jsonl", `${STEP}${STEP}`);

    hydrateFromStreams({ events: RUN, ...at });
    const second = hydrateFromStreams({ events: RUN, ...at });

    expect(second.recovery).toEqual({ recovered: 0, parsed: 0, cached: 1, unresolved: 1 });
    expect(readFileSync(at.cache, "utf8")).toContain('"usage":null');
  });

  it("a run whose stream is not on the box is unresolved, never invented", () => {
    const at = box();
    const { events, recovery } = hydrateFromStreams({ events: RUN, ...at });

    expect(priceOf(events)).toEqual([undefined]);
    expect(recovery).toEqual({ recovered: 0, parsed: 0, cached: 0, unresolved: 1 });
  });

  it("takes the stream of ITS OWN lease when the pair ran twice the same day", () => {
    const at = box();
    stream(at, "2026-07-26T08-00-05Z-dev-core-016-sync.jsonl", RESULT(1.5, 10));
    stream(at, "2026-07-26T10-00-05Z-dev-core-016-sync.jsonl", RESULT(4.5, 40));

    const { events } = hydrateFromStreams({
      events: [
        acquired("2026-07-26T08:00:00Z", "dev-core", "016-sync"),
        released("2026-07-26T09:00:00Z", "dev-core", "016-sync"),
        ...RUN,
      ],
      ...at,
    });

    expect(priceOf(events)).toEqual([1.5, 4.5]);
  });

  it("does not cross roles: another pair's stream is not this run's ledger", () => {
    const at = box();
    stream(at, "2026-07-26T10-00-05Z-curator-016-sync.jsonl", RESULT(9.9, 90));

    const { events, recovery } = hydrateFromStreams({ events: RUN, ...at });

    expect(priceOf(events)).toEqual([undefined]);
    expect(recovery.unresolved).toBe(1);
  });
});

describe("a run that was killed stays priceless", () => {
  it("its stream is not opened at all — no reason a ledger is expected from", () => {
    const at = box();
    stream(at, "2026-07-26T10-00-05Z-dev-core-016-sync.jsonl", `${STEP}${RESULT(4.5, 40)}`);

    const { events, recovery } = hydrateFromStreams({
      events: [
        acquired("2026-07-26T10:00:00Z", "dev-core", "016-sync"),
        released("2026-07-26T11:00:00Z", "dev-core", "016-sync", "quota-exhausted"),
      ],
      ...at,
    });

    expect(priceOf(events)).toEqual([undefined]);
    expect(recovery).toEqual({ recovered: 0, parsed: 0, cached: 0, unresolved: 0 });
  });
});

describe("a run that already carries its block", () => {
  it("is passed through untouched — the writer's ledger is never second-guessed", () => {
    const at = box();
    stream(at, "2026-07-26T10-00-05Z-dev-core-016-sync.jsonl", RESULT(4.5, 40));
    const withBlock = {
      ...released("2026-07-26T11:00:00Z", "dev-core", "016-sync"),
      usage: { costUsd: 1.11, turns: 3 },
    } as OrchestratorEvent;

    const { events, recovery } = hydrateFromStreams({
      events: [acquired("2026-07-26T10:00:00Z", "dev-core", "016-sync"), withBlock],
      ...at,
    });

    expect(priceOf(events)).toEqual([1.11]);
    expect(recovery.parsed).toBe(0);
  });
});
