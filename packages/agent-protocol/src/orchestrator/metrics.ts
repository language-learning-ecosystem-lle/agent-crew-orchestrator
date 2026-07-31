/**
 * THE READING HALF OF 029 — what the circuit burned and how many rounds of review
 * a package costs, folded out of what is ALREADY on the box. Nothing here reaches
 * the network and nothing here is written into git: the storage decision (john,
 * msg-001) is that the raw material stays in `.orchestrator/` and the aggregate is
 * computed at the moment of the question.
 *
 * THE FOLD READS THE JOURNAL, NOT THE TRANSCRIPTS. The writing half (PR #123) stopped
 * throwing the ledger away, so "how much did we spend this week" is a 60 KB file
 * folded in memory instead of 215 MB of streams re-parsed. `sessions/` stays what it
 * is — forensics for one break, not the source of economics.
 *
 * TWO RULES OF OUTPUT RIDE IN THIS FILE, because both were paid for by being wrong once:
 *
 *  1. CURRENCY AND TOKENS ARE TWO COLUMNS, and the second never leaks into the first
 *     (curator, msg-004). A run that was killed before its `result` line has no ledger,
 *     and the per-message `usage` of its stream does NOT reconstruct one: measured on
 *     three finished runs against their own `result` lines, `output` is 15–110× LOW
 *     (streaming partials) and `cache_read` ~2× HIGH (recounted). The error has two
 *     signs and an order of magnitude of spread, so there is no coefficient to save it
 *     with. Hence the priceless class is reported as runs + break class + steps + wall
 *     clock, and says out loud that tokens were not counted for it.
 *
 *  2. EVERY METRIC WITH A BOUNDARY IN ITS OWN DATA PRINTS WHAT IS LEFT BEYOND IT
 *     (curator, msg-009 §4). Silent truncation reads as full coverage. The boundaries
 *     are named one by one rather than felt: the start of the `pr:` anchor, the start of
 *     the `usage` block, the start of the stream era (`sessions/*.jsonl`), and the
 *     future rotation of `sessions/`. In `--json` each is a FIELD — the resident (R23)
 *     has no eye to notice a footnote with.
 *
 * ABSENCE IS NOT JUDGED BY A TIMESTAMP (curator's eleventh condition, msg-017). A daemon
 * runs the code it started with, so a box whose writer is older than the schema writes
 * blockless lines long after the field exists — a window that opens again at EVERY merge
 * and closes only at a restart. So "no block after the era began" is its own named row,
 * PRINTED with its window and roles, never quali­fied as a loss on the seam.
 */

import type { OrchestratorEvent, ReleaseReason } from "./journal.js";

/** A reviewer's verdict as it lies on disk: the body's first two lines, and when. */
export type VerdictRecord = {
  readonly ts: string;
  /** The `pr:` anchor (#75, merged 2026-07-29). `null` — a verdict from before it. */
  readonly pr: number | null;
  readonly verdict: "approve" | "needs-fixes";
};

/** A `github` message that closed a PR — the interval's right edge, and the evidence
 * of which numbers already existed before the anchor era. */
export type MergeRecord = { readonly ts: string; readonly pr: number };

export type MetricsInput = {
  readonly events: readonly OrchestratorEvent[];
  readonly verdicts: readonly VerdictRecord[];
  readonly merges: readonly MergeRecord[];
  /**
   * The timestamp of the EARLIEST stream on disk. Runs older than it have no stream to
   * have lost a block from — the fourth boundary (curator, msg-014 §1). Absent: no
   * stream on the box at all, so the boundary cannot be drawn and is not claimed.
   */
  readonly streamEraStart?: string | undefined;
  /** Filters, all optional and all applied to the journal side only. */
  readonly since?: string;
  readonly role?: string;
  readonly thread?: string;
};

export type PricedTotals = {
  readonly runs: number;
  readonly costUsd: number;
  readonly turns: number;
  readonly durationSec: number;
};

export type CutRow = PricedTotals & { readonly key: string };

/** A run with no ledger, grouped by the reason the lease was released. */
export type PricelessRow = {
  readonly reason: ReleaseReason;
  readonly runs: number;
  readonly steps: number;
  readonly wallClockSec: number;
};

/** What sits beyond a boundary of the data — printed, never silently dropped. */
export type BoundaryRow = {
  readonly runs: number;
  readonly from: string;
  readonly to: string;
  readonly roles: readonly string[];
};

export type Economy = {
  readonly priced: PricedTotals;
  readonly byRole: readonly CutRow[];
  readonly byThread: readonly CutRow[];
  readonly byDay: readonly CutRow[];
  /**
   * NO LEDGER BY CONSTRUCTION: the run was killed before its `result` line
   * (`quota-exhausted`, `timeout`, `supervisor-gone`). This is legal absence, and it is
   * biased — the runs that burned the window to the end are exactly the ones with no
   * price — so it belongs in the main table, not in a footnote.
   */
  readonly priceless: readonly PricelessRow[];
  /** Runs whose release predates any stream on the box: nothing was lost, the era had
   * not begun (curator, msg-014 §1). */
  readonly preStreamEra?: BoundaryRow | undefined;
  /**
   * `completed`/`exited-without-handoff` with no block, inside the stream era. PRINTED
   * as a fact and NOT called a loss: the writer on the box can be older than the schema
   * in the repository at any moment (the eleventh condition).
   */
  readonly blockAbsentAfterEra?: BoundaryRow | undefined;
  /** The tokens sentence, carried as data so `--json` says it too. */
  readonly tokensNote: string;
};

export type ReviewRounds = {
  /** When the anchor era begins — the first verdict carrying a `pr:` line. */
  readonly anchorFrom: string | null;
  /** Verdicts from before the anchor: countable, not attributable to a PR. */
  readonly unanchored: number;
  /** Rounds over the anchor era, split by what preceded them. */
  readonly firstRounds: number;
  /** A round after `needs-fixes` — the quality of the submission (what john asked about). */
  readonly redoRounds: number;
  /**
   * A round after `approve` — a rebase moved the head, so the verdict had to be issued
   * again. THE PRICE OF THE CHOSEN DISCIPLINE, not a loss: guard 1 wants an approve on
   * the head that merges and guard 2 green checks on that same head, so every rebase
   * under a moving `main` voids the verdict by construction (curator, msg-009 §3).
   */
  readonly reconfirmRounds: number;
  /** Green with the FIRST verdict, not the ONLY one (curator, msg-009 §6.1). */
  readonly greenFirstSubmission: number;
  readonly measuredPrs: readonly number[];
  /**
   * PRs whose first verdict may be older than the anchor: they enter NEITHER the
   * numerator NOR the denominator of "green first submission", and are named here
   * instead (curator, msg-009 §6.3). The test is the number itself — PR numbers only
   * grow, so a number at or below the highest one already merged before the anchor era
   * could have been reviewed before it. The row empties itself out as those PRs close.
   */
  readonly partiallyAnchored: readonly number[];
};

export type Metrics = { readonly economy: Economy; readonly review: ReviewRounds };

const TOKENS_NOTE =
  "tokens are not counted for these runs: the stream's per-message `usage` is not a ledger " +
  "(output 15–110× low, cache_read ~2× high — two signs of error, so no coefficient saves it)";

const day = (ts: string): string => ts.slice(0, 10);

const addTo = (into: Map<string, PricedTotals>, key: string, add: PricedTotals): void => {
  const at = into.get(key) ?? { runs: 0, costUsd: 0, turns: 0, durationSec: 0 };
  into.set(key, {
    runs: at.runs + add.runs,
    costUsd: at.costUsd + add.costUsd,
    turns: at.turns + add.turns,
    durationSec: at.durationSec + add.durationSec,
  });
};

const rowsOf = (from: Map<string, PricedTotals>): CutRow[] =>
  [...from.entries()]
    .map(([key, totals]) => ({ key, ...totals }))
    .sort((a, b) => b.costUsd - a.costUsd || a.key.localeCompare(b.key));

const boundaryOf = (releases: readonly { ts: string; role: string }[]): BoundaryRow | undefined => {
  if (releases.length === 0) return undefined;
  const stamps = releases.map((r) => r.ts).sort();
  const roles = [...new Set(releases.map((r) => r.role))].sort();
  return {
    runs: releases.length,
    from: stamps[0] as string,
    to: stamps[stamps.length - 1] as string,
    roles,
  };
};

/**
 * THE DISCRIMINATOR IS THE REASON, and it was measured rather than guessed (msg-013 §4):
 * crossed against the journal, the `result` line is missing from ALL 23 `quota-exhausted`
 * releases and present for every `completed`/`exited-without-handoff` whose stream is on
 * disk. So the two reasons that REACHED THEIR OWN END are the only ones a ledger is
 * expected from; every other reason killed the run before the `result` line, and its
 * absence is legal by construction rather than lost on the seam.
 */
const EXPECTED_LEDGER: readonly ReleaseReason[] = ["completed", "exited-without-handoff"];

const isBroken = (reason: ReleaseReason): boolean => !EXPECTED_LEDGER.includes(reason);

export const foldEconomy = (input: MetricsInput): Economy => {
  const byRole = new Map<string, PricedTotals>();
  const byThread = new Map<string, PricedTotals>();
  const byDay = new Map<string, PricedTotals>();
  const priceless = new Map<ReleaseReason, { runs: number; steps: number; wallClockSec: number }>();
  const preStream: { ts: string; role: string }[] = [];
  const blockless: { ts: string; role: string }[] = [];
  let priced: PricedTotals = { runs: 0, costUsd: 0, turns: 0, durationSec: 0 };

  // The lease each pair last took: the wall clock of a run with no ledger is the only
  // duration it has, and it is the interval of its own lease.
  // The separator is a byte no slug carries, and it is written as an ESCAPE rather than
  // typed into the source: a control byte in the file makes git classify it as binary and
  // the diff of this file stops being readable — the class `sources.test.ts` guards (thread
  // 023). The key is the same at run time; only the source stays text.
  const acquired = new Map<string, string>();
  const pairOf = (event: { role: string; thread: string }): string =>
    `${event.role}\u0000${event.thread}`;

  for (const event of input.events) {
    if (input.since !== undefined && event.ts < input.since) continue;
    if (input.role !== undefined && event.role !== input.role) continue;
    if (input.thread !== undefined && event.thread !== input.thread) continue;
    if (event.kind === "lease-acquired") {
      acquired.set(pairOf(event), event.ts);
      continue;
    }
    if (event.kind !== "lease-released") continue;

    const took = acquired.get(pairOf(event));
    acquired.delete(pairOf(event));
    const usage = event.usage;
    if (usage !== undefined && usage.costUsd !== undefined) {
      const add: PricedTotals = {
        runs: 1,
        costUsd: usage.costUsd,
        turns: usage.turns ?? 0,
        durationSec: usage.durationSec ?? 0,
      };
      priced = {
        runs: priced.runs + 1,
        costUsd: priced.costUsd + add.costUsd,
        turns: priced.turns + add.turns,
        durationSec: priced.durationSec + add.durationSec,
      };
      addTo(byRole, event.role, add);
      addTo(byThread, event.thread, add);
      addTo(byDay, day(event.ts), add);
      continue;
    }

    // No ledger. WHICH kind of absence this is decides the row it goes to, and none of
    // the three is a fault: a break has no `result` line, a pre-stream run has no stream,
    // and a blockless line inside the era means the writer on the box is older than the
    // schema — a window that reopens at every merge.
    const wall =
      took === undefined ? 0 : Math.max(0, (Date.parse(event.ts) - Date.parse(took)) / 1000);
    if (isBroken(event.reason)) {
      const at = priceless.get(event.reason) ?? { runs: 0, steps: 0, wallClockSec: 0 };
      priceless.set(event.reason, {
        runs: at.runs + 1,
        steps: at.steps + (event.steps ?? 0),
        wallClockSec: at.wallClockSec + wall,
      });
      continue;
    }
    if (input.streamEraStart !== undefined && event.ts < input.streamEraStart) {
      preStream.push({ ts: event.ts, role: event.role });
      continue;
    }
    blockless.push({ ts: event.ts, role: event.role });
  }

  return {
    priced,
    byRole: rowsOf(byRole),
    byThread: rowsOf(byThread),
    byDay: rowsOf(byDay).sort((a, b) => a.key.localeCompare(b.key)),
    priceless: [...priceless.entries()]
      .map(([reason, row]) => ({ reason, ...row }))
      .sort((a, b) => b.runs - a.runs || a.reason.localeCompare(b.reason)),
    preStreamEra: boundaryOf(preStream),
    blockAbsentAfterEra: boundaryOf(blockless),
    tokensNote: TOKENS_NOTE,
  };
};

export const foldReview = (input: MetricsInput): ReviewRounds => {
  const ordered = [...input.verdicts].sort((a, b) => a.ts.localeCompare(b.ts));
  const anchored = ordered.filter((v): v is VerdictRecord & { pr: number } => v.pr !== null);
  const anchorFrom = anchored.length === 0 ? null : (anchored[0] as VerdictRecord).ts;
  const unanchored = ordered.length - anchored.length;

  // WHICH NUMBERS COULD BE OLDER THAN THE ANCHOR. PR numbers only grow, so any number
  // at or below the highest one already merged before the era began may have been
  // reviewed before it, and its first verdict is not the first verdict we can see.
  const threshold =
    anchorFrom === null
      ? 0
      : input.merges.filter((m) => m.ts < anchorFrom).reduce((high, m) => Math.max(high, m.pr), 0);

  const rounds = new Map<number, VerdictRecord[]>();
  for (const verdict of anchored) {
    const at = rounds.get(verdict.pr as number) ?? [];
    at.push(verdict);
    rounds.set(verdict.pr as number, at);
  }

  let firstRounds = 0;
  let redoRounds = 0;
  let reconfirmRounds = 0;
  let greenFirstSubmission = 0;
  const measuredPrs: number[] = [];
  const partiallyAnchored: number[] = [];

  for (const [pr, list] of [...rounds.entries()].sort((a, b) => a[0] - b[0])) {
    list.forEach((_verdict, index) => {
      if (index === 0) {
        firstRounds += 1;
        return;
      }
      const previous = list[index - 1] as VerdictRecord;
      if (previous.verdict === "needs-fixes") redoRounds += 1;
      else reconfirmRounds += 1;
    });
    if (pr <= threshold) {
      partiallyAnchored.push(pr);
      continue;
    }
    measuredPrs.push(pr);
    if ((list[0] as VerdictRecord).verdict === "approve") greenFirstSubmission += 1;
  }

  return {
    anchorFrom,
    unanchored,
    firstRounds,
    redoRounds,
    reconfirmRounds,
    greenFirstSubmission,
    measuredPrs,
    partiallyAnchored,
  };
};

export const foldMetrics = (input: MetricsInput): Metrics => ({
  economy: foldEconomy(input),
  review: foldReview(input),
});

const money = (value: number): string => `$${value.toFixed(2)}`;
const hours = (seconds: number): string => `${(seconds / 3600).toFixed(1)}h`;

/**
 * The human view. Every boundary row is printed even when the count would let it be
 * skipped in silence — that silence is exactly what msg-009 §4 forbids.
 */
export const renderMetrics = (metrics: Metrics): string[] => {
  const { economy: e, review: r } = metrics;
  const lines: string[] = [];
  lines.push(
    `economics: ${money(e.priced.costUsd)} · ${e.priced.runs} runs with a ledger · ${e.priced.turns} turns · ${hours(e.priced.durationSec)}`,
  );
  for (const row of e.byRole) {
    lines.push(`  role ${row.key}  ${money(row.costUsd)}  ${row.runs} runs  ${row.turns} turns`);
  }
  for (const row of e.byThread.slice(0, 10)) {
    lines.push(`  thread ${row.key}  ${money(row.costUsd)}  ${row.runs} runs`);
  }
  for (const row of e.byDay) {
    lines.push(`  day ${row.key}  ${money(row.costUsd)}  ${row.runs} runs`);
  }

  const pricelessRuns = e.priceless.reduce((sum, row) => sum + row.runs, 0);
  lines.push(`no ledger (killed before the run's own result line): ${pricelessRuns} runs`);
  for (const row of e.priceless) {
    lines.push(
      `  ${row.reason}  ${row.runs} runs  ${row.steps} steps  ${hours(row.wallClockSec)} of lease`,
    );
  }
  lines.push(`  ${e.tokensNote}`);

  if (e.preStreamEra !== undefined) {
    const b = e.preStreamEra;
    lines.push(
      `before the stream era: ${b.runs} runs, ${b.from}…${b.to}, roles ${b.roles.join(", ")} — no stream existed, nothing was lost`,
    );
  }
  if (e.blockAbsentAfterEra !== undefined) {
    const b = e.blockAbsentAfterEra;
    lines.push(
      `no usage block after the era began: ${b.runs} runs, ${b.from}…${b.to}, roles ${b.roles.join(", ")} — printed, not called a loss (a daemon runs the code it started with)`,
    );
  }

  lines.push(
    r.anchorFrom === null
      ? "review rounds: no anchored verdict yet — the whole history is a ratio without an anchor"
      : `review rounds since ${r.anchorFrom}: ${r.firstRounds} first · ${r.redoRounds} after needs-fixes (quality of the submission) · ${r.reconfirmRounds} after approve (the price of the chosen discipline)`,
  );
  lines.push(
    `green with the first verdict: ${r.greenFirstSubmission} of ${r.measuredPrs.length} fully anchored PRs`,
  );
  lines.push(
    `verdicts from before the anchor: ${r.unanchored} — countable, not attributable to a PR`,
  );
  lines.push(
    r.partiallyAnchored.length === 0
      ? "partially anchored PRs: none"
      : `partially anchored PRs (counted in neither the numerator nor the denominator): ${r.partiallyAnchored.join(", ")}`,
  );
  return lines;
};
