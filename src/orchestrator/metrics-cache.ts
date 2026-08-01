/**
 * THE HISTORY THAT PREDATES THE WRITER (thread 029, msg-003 §2) — the ledger of a run
 * whose `lease-released` carries no `usage` block, recovered from its own stream ONCE
 * and remembered in a local cache.
 *
 * WHY THIS EXISTS AT ALL, when the whole point of the writing half (PR #123) was that
 * `metrics` never opens `sessions/`. Because the journal is append-only and we respect
 * that on disk exactly as we respect it in the mail: the lines written before the block
 * existed are not going to be rewritten. Their streams, however, are still on the box,
 * and the ledger is in them — so the history is READ once per stream instead of being
 * either lost or back-filled into the journal.
 *
 * THE ONE-TIME-NESS IS THE FEATURE. 305 runs on this box have no block, and their
 * streams are ~99 MB; a resident answering "what did the week cost" cannot re-parse
 * that per question. Hence `.orchestrator/metrics.cache.jsonl`, keyed by STREAM NAME
 * PLUS FILE SIZE (john's shape in msg-003 §2): a size that changed means the stream was
 * still being written when it was read, so the entry is recomputed rather than trusted.
 *
 * A MISS IS CACHED TOO. A stream with no `result` line — the run was killed before it —
 * is remembered as `null`, not as "not looked at yet". Without that, exactly the files
 * that can never yield anything are the ones re-read on every single call.
 *
 * ONLY THE TAIL OF A STREAM IS READ. The ledger rides on the LAST event of the run
 * (`type: "result"`, see `runUsageOf`), so a bounded window off the end answers the
 * question; reading 99 MB to reach the final line would defeat the cache it fills.
 * A stream whose result line does not fit the window is recorded as a miss, and that is
 * the same honest absence as a run that never wrote one — never an invented number.
 *
 * WHAT IS NOT DONE HERE, deliberately: the per-message `usage` of a stream is NOT summed
 * for the runs that have no `result` line (it is 15–110× low on `output` and ~2× high on
 * `cache_read` — the measurement in `transcript.ts` → `runUsageOf`). A broken run stays
 * priceless in the fold, exactly as it is today.
 */
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import type { OrchestratorEvent } from "./journal.js";
import { type RunUsage, runUsageOf } from "./transcript.js";

/** How much of a stream's end is read looking for its `result` line. */
const TAIL_BYTES = 1024 * 1024;

/** `2026-07-25T16-29-42Z-dev-core-016-thread.jsonl` — the moment the stream was opened. */
const STREAM_STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-/;

/** A run a ledger is expected from: the two reasons that reached their own end. */
const EXPECTED_LEDGER = new Set(["completed", "exited-without-handoff"]);

/** One remembered stream: what was read out of it, or that there was nothing to read. */
type CacheEntry = { readonly size: number; readonly usage: RunUsage | null };

/**
 * What the recovery did, so the command can PRINT it rather than let numbers move for
 * unexplained reasons (the boundary rule, msg-009 §4): a fold whose history silently
 * grows richer between two calls is a fold nobody can check.
 */
export type StreamRecovery = {
  /** Runs whose ledger was restored out of a stream and now carry a price. */
  readonly recovered: number;
  /** Streams opened and parsed on THIS call — the cost the cache is there to remove. */
  readonly parsed: number;
  /** Streams answered out of the cache without being opened. */
  readonly cached: number;
  /** Blockless runs whose stream is not on the box (rotated away, or never kept). */
  readonly unresolved: number;
};

export type Hydrated = {
  readonly events: readonly OrchestratorEvent[];
  readonly recovery: StreamRecovery;
};

/** `<stamp>-<role>-<thread>.jsonl` → the moment, and the pair the run belonged to. */
const splitStream = (name: string): { stamp: string; pair: string } | undefined => {
  const said = STREAM_STAMP.exec(name);
  if (said === null) return undefined;
  const pair = basename(name, ".jsonl").slice((said[0] as string).length);
  if (pair === "") return undefined;
  return { stamp: `${said[1]}T${said[2]}:${said[3]}:${said[4]}Z`, pair };
};

const readCache = (path: string): Map<string, CacheEntry> => {
  const entries = new Map<string, CacheEntry>();
  if (!existsSync(path)) return entries;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return entries;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      // The cache is OUR OWN derived file, so a line that does not parse is dropped
      // rather than refused: the worst it costs is one stream re-read.
      const raw = JSON.parse(trimmed) as {
        stream?: string;
        size?: number;
        usage?: RunUsage | null;
      };
      if (typeof raw.stream !== "string" || typeof raw.size !== "number") continue;
      entries.set(raw.stream, { size: raw.size, usage: raw.usage ?? null });
    } catch {}
  }
  return entries;
};

const writeCache = (path: string, entries: Map<string, CacheEntry>): void => {
  const body = [...entries.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([stream, entry]) => JSON.stringify({ stream, size: entry.size, usage: entry.usage }))
    .join("\n");
  // Written through a temporary name: two `metrics` calls racing must never leave half
  // a cache behind, and a truncated cache reads as "nothing known" on the next call.
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, body === "" ? "" : `${body}\n`);
  renameSync(tmp, path);
};

/** The last `TAIL_BYTES` of a file as complete lines (a leading partial line dropped). */
const tailLines = (path: string, size: number): string[] => {
  const from = Math.max(0, size - TAIL_BYTES);
  const length = size - from;
  if (length === 0) return [];
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, length, from);
  } finally {
    closeSync(fd);
  }
  const lines = buffer.toString("utf8").split("\n");
  return from === 0 ? lines : lines.slice(1);
};

/** The ledger of one stream, or `null` if it holds none (a break, or a tail too far). */
const ledgerOf = (path: string, size: number): RunUsage | null => {
  let found: RunUsage | null = null;
  for (const line of tailLines(path, size)) {
    const usage = runUsageOf(line);
    if (usage !== undefined) found = usage;
  }
  return found;
};

/**
 * The journal, with the runs that predate the `usage` block priced out of their own
 * streams. Everything else is passed through untouched — including the broken runs,
 * which have no honest ledger anywhere and stay in the priceless class.
 */
export const hydrateFromStreams = (input: {
  readonly events: readonly OrchestratorEvent[];
  readonly sessions: string;
  readonly cache: string;
}): Hydrated => {
  const blank: StreamRecovery = { recovered: 0, parsed: 0, cached: 0, unresolved: 0 };
  const candidates = input.events.filter(
    (event) =>
      event.kind === "lease-released" &&
      event.usage === undefined &&
      EXPECTED_LEDGER.has(event.reason),
  );
  if (candidates.length === 0 || !existsSync(input.sessions)) {
    return {
      events: input.events,
      recovery: { ...blank, unresolved: candidates.length },
    };
  }

  // The streams of the box, indexed by the pair they belong to. The name carries role
  // and thread after the stamp, which is why a run can be matched to its stream without
  // the journal ever having named the file.
  const streams = new Map<string, { name: string; stamp: string }[]>();
  for (const name of readdirSync(input.sessions)) {
    if (!name.endsWith(".jsonl")) continue;
    const split = splitStream(name);
    if (split === undefined) continue;
    const at = streams.get(split.pair) ?? [];
    at.push({ name, stamp: split.stamp });
    streams.set(split.pair, at);
  }

  // When the lease was taken: the stream is opened after the acquisition and closed
  // before the release, so the pair of stamps is what tells one run's stream from the
  // next run of the SAME pair on the same day.
  const acquired = new Map<string, string>();
  const heldFrom = new Map<OrchestratorEvent, string>();
  for (const event of input.events) {
    if (event.kind !== "lease-acquired" && event.kind !== "lease-released") continue;
    // The separator is written as an ESCAPE, never typed: a control byte in the file
    // makes git call it binary and the diff stops being readable (`sources.test.ts`,
    // thread 023). The key is the same byte at run time; only the source stays text.
    const pair = `${event.role}\u0000${event.thread}`;
    if (event.kind === "lease-acquired") {
      acquired.set(pair, event.ts);
      continue;
    }
    const took = acquired.get(pair);
    acquired.delete(pair);
    if (took !== undefined) heldFrom.set(event, took);
  }

  const entries = readCache(input.cache);
  let parsed = 0;
  let cached = 0;
  let recovered = 0;
  let unresolved = 0;
  const priced = new Map<OrchestratorEvent, RunUsage>();

  for (const event of candidates) {
    if (event.kind !== "lease-released") continue;
    const took = heldFrom.get(event);
    const mine = (streams.get(`${event.role}-${event.thread}`) ?? [])
      .filter((s) => s.stamp <= event.ts && (took === undefined || s.stamp >= took))
      .sort((a, b) => a.stamp.localeCompare(b.stamp));
    const stream = mine[mine.length - 1];
    if (stream === undefined) {
      unresolved += 1;
      continue;
    }
    const path = join(input.sessions, stream.name);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      unresolved += 1;
      continue;
    }
    const known = entries.get(stream.name);
    let usage: RunUsage | null;
    if (known !== undefined && known.size === size) {
      usage = known.usage;
      cached += 1;
    } else {
      usage = ledgerOf(path, size);
      entries.set(stream.name, { size, usage });
      parsed += 1;
    }
    if (usage === null || usage.costUsd === undefined) {
      unresolved += 1;
      continue;
    }
    priced.set(event, usage);
    recovered += 1;
  }

  if (parsed > 0) {
    try {
      writeCache(input.cache, entries);
    } catch {
      // A cache that cannot be written costs the next call a re-parse and nothing else;
      // refusing to answer the question over it would be the worse trade.
    }
  }

  return {
    events:
      priced.size === 0
        ? input.events
        : input.events.map((event) => {
            const usage = priced.get(event);
            return usage === undefined ? event : { ...event, usage };
          }),
    recovery: { recovered, parsed, cached, unresolved },
  };
};
