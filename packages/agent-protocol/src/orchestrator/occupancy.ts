/**
 * THE DAY REPORT — the two shares side by side, computed by a command instead of by hand
 * (john's decision 2026-08-30 ~13:10Z, point 3, thread 042; `docs/protocol-reference.md` §6.4).
 *
 * The eighth class judges a standstill by the FREE part of a standing turn, and a box whose
 * roles are busy 87–93 % of the window has a small free part under EVERY waiting pair by
 * construction. So "no candidates" is evidence of nothing until the occupancy beside it is
 * known — the same blindness the dry `notify` has, only over the whole day instead of one run.
 * Both numbers were measured by hand three times over (curator 87/87/88 %, dev-core 93/93/91 %
 * over windows of 177, 187 and 208 minutes from the daemon's epoch `2026-08-30T08:32:17Z`), and
 * a number a person recomputes by hand every time it is asked for is a number nobody asks for.
 *
 * TWO RULES RIDE IN THIS FILE, and both are paid for by the thread that produced it:
 *
 *  1. THE FREE PART IS NOT COMPUTED HERE. It is {@link freeTailMinutes} — the courier's own
 *     arithmetic, the one #147 rewrote from a sum of slivers into the uninterrupted tail — and
 *     this fold CALLS it rather than reproducing it. Two instruments that disagree on one input
 *     turn every future reading into "which of them do we believe", which is the disease this
 *     thread has been treating since the first false call.
 *
 *  2. WHAT IS DROPPED IS SAID OUT LOUD. A rotated journal hands back a `lease-released` whose
 *     `lease-acquired` is in the file that is gone, and no span is invented for it (the same
 *     `if (from === undefined) continue` the courier has). Dropping those in silence lowers the
 *     occupancy and raises every free part — a lie of exactly the kind #147 was fixing — so the
 *     count is a field of the output and a line of the render, zero or not.
 *
 * NO THRESHOLD IS APPLIED AND NONE IS INVENTED. What counts as a significant free share john
 * left open (§6.4, "Чего этим решением НЕ решено"); this command prints the numbers and colours
 * nothing. A number without a threshold is already worth the run — it is interpretable, which
 * is the whole complaint about the zero that had no occupancy beside it.
 */

import { freeTailMinutes } from "../notify/notify.js";
import type { OrchestratorEvent } from "./journal.js";

/** A standing turn as the mail knows it: the pair and the stamp the turn passed at. */
export type StandingTurn = {
  readonly role: string;
  readonly thread: string;
  readonly since: string;
};

/** A freeze of a thread behind a park of any kind, replayed out of the feed. */
export type ParkSpan = {
  readonly thread: string;
  readonly from: string;
  readonly to?: string;
};

/** How much of the window a role spent holding a lease. */
export type OccupancyRow = {
  readonly role: string;
  readonly busyMinutes: number;
  /** `busyMinutes / windowMinutes`, 0…1. The window is the same for every role. */
  readonly share: number;
  readonly sessions: number;
};

/**
 * A pair standing at the end of the window: the whole of its standing time and the part of it
 * the box was actually free to take the turn in. The two differ by the role's own queue and by
 * every park over the thread, and the live case that named this row is `curator×052` — 60.7
 * minutes of standing under 2.2 minutes of free tail.
 */
export type StandingRow = {
  readonly role: string;
  readonly thread: string;
  readonly since: string;
  /** Wall clock from the handoff to `now`, whatever blocked it. */
  readonly standingMinutes: number;
  /** {@link freeTailMinutes} — the uninterrupted tail, explicitly `0` when there is none. */
  readonly freeMinutes: number;
};

export type DayReport = {
  readonly from: string;
  readonly to: string;
  readonly windowMinutes: number;
  /** WHERE the left edge came from, in words, because a window whose start is guessed at by
   * the reader is a window that gets compared against another one silently. */
  readonly windowSource: string;
  readonly roles: readonly OccupancyRow[];
  readonly standing: readonly StandingRow[];
  /** `lease-released` with no `lease-acquired` to answer: a span nobody measured, not invented
   * here and not passed over in silence. */
  readonly droppedReleases: number;
  /** The sentence about the missing threshold, carried as data so `--json` says it too. */
  readonly thresholdNote: string;
};

const THRESHOLD_NOTE =
  "no threshold is applied to either share: what counts as a significant free part is john's " +
  "to set (§6.4) and is not decided here — these are measurements, not verdicts";

const WINDOW_FROM_FLAG = "--since, given by hand";
const WINDOW_FROM_JOURNAL =
  "the earliest event in the journal on this box — the daemon's own clock, which starts when " +
  "the running process began carrying its code and NOT at the merge that changed it (§6.4)";

/**
 * WHEN EACH ROLE HELD A LEASE, as closed spans — the same walk the courier does over the same
 * journal (`cli.ts`, the `notify` fold): one slot per role, a lease still open at the end of the
 * file is that role's live session and is closed at `now`, and a release with no acquisition
 * names no span at all.
 *
 * The dropped releases are COUNTED as they are skipped. That is the difference between this walk
 * and the courier's: the courier judges one pair and a missing span only makes it more likely to
 * ring, while a report that eats them silently reports a box less busy than it was.
 */
export const leaseSpans = (
  events: readonly OrchestratorEvent[],
  now: Date,
): { spans: { role: string; from: string; to: string }[]; dropped: number } => {
  const spans: { role: string; from: string; to: string }[] = [];
  const open = new Map<string, string>();
  let dropped = 0;
  for (const event of events) {
    if (event.kind === "lease-acquired") {
      open.set(event.role, event.ts);
      continue;
    }
    if (event.kind !== "lease-released") continue;
    const from = open.get(event.role);
    if (from === undefined) {
      dropped += 1;
      continue;
    }
    open.delete(event.role);
    spans.push({ role: event.role, from, to: event.ts });
  }
  for (const [role, from] of open) spans.push({ role, from, to: now.toISOString() });
  return { spans, dropped };
};

const clippedMinutes = (
  spans: readonly { from: string; to: string }[],
  from: number,
  to: number,
): number => {
  let sum = 0;
  for (const span of spans) {
    const start = Math.max(Date.parse(span.from), from);
    const end = Math.min(Date.parse(span.to), to);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start)
      sum += (end - start) / 60_000;
  }
  return sum;
};

/**
 * THE FOLD. Everything it needs is already on the box: the journal for the leases, the mail for
 * the standing pairs and their parks. Nothing here asks for a live lease of its own — the
 * instrument must not be blind exactly where it measures (§6.4, the note about the dry `notify`
 * run from a raised session).
 *
 * `role`/`thread` filter the ROWS ONLY. The arithmetic is folded whole first: a free tail is a
 * statement about the role's other threads and about this thread's parks, so folding a filtered
 * journal would hand back a number that is wrong in the direction of the alarm.
 */
export const foldDay = (input: {
  readonly events: readonly OrchestratorEvent[];
  readonly turns: readonly StandingTurn[];
  readonly parks?: readonly ParkSpan[];
  readonly now: Date;
  /** The left edge of the window; absent — the journal's own first event. */
  readonly since?: string | undefined;
  readonly role?: string | undefined;
  readonly thread?: string | undefined;
}): DayReport => {
  const { spans, dropped } = leaseSpans(input.events, input.now);
  const until = input.now.getTime();
  const first = input.events[0]?.ts;
  const startedAt = input.since ?? first;
  const from = startedAt === undefined ? until : Date.parse(startedAt);
  const windowMinutes = Math.max(0, until - from) / 60_000;

  const busy = new Map<string, { minutes: number; sessions: number }>();
  for (const span of spans) {
    const minutes = clippedMinutes([span], from, until);
    const at = busy.get(span.role) ?? { minutes: 0, sessions: 0 };
    busy.set(span.role, {
      minutes: at.minutes + minutes,
      sessions: at.sessions + (minutes > 0 ? 1 : 0),
    });
  }

  const roles: OccupancyRow[] = [...busy.entries()]
    .filter(([role]) => input.role === undefined || role === input.role)
    .map(([role, at]) => ({
      role,
      busyMinutes: at.minutes,
      share: windowMinutes === 0 ? 0 : at.minutes / windowMinutes,
      sessions: at.sessions,
    }))
    .sort((a, b) => b.share - a.share || a.role.localeCompare(b.role));

  const standing: StandingRow[] = input.turns
    .filter((turn) => input.role === undefined || turn.role === input.role)
    .filter((turn) => input.thread === undefined || turn.thread === input.thread)
    .flatMap((turn) => {
      const stood = (until - Date.parse(turn.since)) / 60_000;
      if (!Number.isFinite(stood)) return [];
      // A HANDOFF AFTER THE RIGHT EDGE DID NOT STAND IN THIS WINDOW. It happens on every
      // historical window (`--now` in the past, the mail read as it is today) and it printed as
      // `0.0m in all, free 0.0m` — a row indistinguishable from a pair that really stood and was
      // never free, which is the one distinction this report exists to make.
      if (stood < 0) return [];
      return [
        {
          role: turn.role,
          thread: turn.thread,
          since: turn.since,
          standingMinutes: Math.max(0, stood),
          // THE ONE ARITHMETIC, not a second copy of it: this is the courier's own function,
          // and if this line ever stops calling it the box has two instruments again.
          freeMinutes: freeTailMinutes(
            { busy: spans, ...(input.parks === undefined ? {} : { parks: input.parks }) },
            turn,
            input.now,
          ),
        },
      ];
    })
    .sort((a, b) => b.standingMinutes - a.standingMinutes || a.thread.localeCompare(b.thread));

  return {
    from: startedAt ?? input.now.toISOString(),
    to: input.now.toISOString(),
    windowMinutes,
    windowSource: input.since !== undefined ? WINDOW_FROM_FLAG : WINDOW_FROM_JOURNAL,
    roles,
    standing,
    droppedReleases: dropped,
    thresholdNote: THRESHOLD_NOTE,
  };
};

const percent = (share: number): string => `${Math.round(share * 100)} %`;
const minutes = (value: number): string => `${value.toFixed(1)}m`;

/**
 * The human view. The dropped count and the threshold note are printed ALWAYS — a boundary that
 * only appears when it is non-zero reads as full coverage on every other day.
 */
export const renderDay = (report: DayReport): string[] => {
  const lines: string[] = [];
  lines.push(
    `day window ${report.from}…${report.to} (${minutes(report.windowMinutes)}) · start from: ${report.windowSource}`,
  );
  if (report.roles.length === 0) lines.push("  no lease of any role fell inside this window");
  for (const row of report.roles) {
    lines.push(
      `  role ${row.role}  busy ${percent(row.share)}  ${minutes(row.busyMinutes)} over ${row.sessions} session(s)`,
    );
  }
  if (report.standing.length === 0) lines.push("  no turn is standing at the end of the window");
  for (const row of report.standing) {
    lines.push(
      `  standing ${row.role}×${row.thread}  ${minutes(row.standingMinutes)} in all  free ${minutes(row.freeMinutes)}  since ${row.since}`,
    );
  }
  lines.push(
    `  releases with no acquisition in this journal: ${report.droppedReleases} — no span invented for them, so the busy shares above are a LOWER bound`,
  );
  lines.push(`  ${report.thresholdNote}`);
  return lines;
};
