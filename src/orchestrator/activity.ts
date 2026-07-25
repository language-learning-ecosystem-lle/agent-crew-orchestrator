/**
 * IDLE DETECTION BY TRACES OF ACTIVITY — the pure core of R6 part 2 (thread 016,
 * curator's statement of work 16:10).
 *
 * The problem it answers: on 2026-07-25 both breaks recorded as `timeout` were
 * false in meaning. The sessions were not stuck — they were working longer than
 * the window. A wall clock cannot tell those two apart by construction: it
 * measures the passage of time, and a session that hangs and a session that works
 * spend time identically. What separates them is not duration but SIDE EFFECTS:
 * a working session writes output, touches files and makes commits; a hung one
 * produces nothing at all.
 *
 * WHY SIDE EFFECTS AND NOT THE CONTENT OF THE OUTPUT. Judging "is it doing
 * something meaningful" by the text (repetition, coherence, a loop of the same
 * thought) means a heuristic over a language model's output — and both of its
 * errors are expensive: a false stall kills live work, a missed one leaves the
 * quota burning. A trace is objective: bytes either appeared or they did not.
 *
 * WHY SEVERAL TRACES AND NOT JUST THE LOG. The log is the loudest of them, and it
 * is exactly the trace that was broken until R6 part 1 — a detector resting on a
 * single signal inherits every failure of that signal. The others are independent:
 * the working tree changes when the session edits files, the head commit moves
 * when it commits, CPU time grows while the process computes. Any ONE of them
 * moving means life; a stall requires all of them to be still.
 *
 * The decision is pure: the sampling of the traces (files, git, /proc) lives in
 * the CLI where the IO is, exactly as with the rest of the orchestrator.
 */

/**
 * A snapshot of "what the session has produced by now". Fields are chosen to be
 * MONOTONIC or comparable, never interpreted: the detector only asks whether the
 * snapshot differs from the previous one.
 */
export type ActivityTrace = {
  /** The size of the session output on disk — the loudest trace (R6 part 1). */
  readonly logBytes: number;
  /**
   * A signature of the working tree: the dirty set plus the head commit. Covers
   * both halves of "the session did something with the code" — an edit that is not
   * committed yet and a commit that cleaned the tree.
   */
  readonly worktree: string;
  /**
   * Cumulative CPU time of the session's process group, in milliseconds. The one
   * trace that grows even when the session writes nothing — a long thinking turn
   * with no output still burns processor time. `undefined` where it cannot be
   * measured (no /proc): an unavailable trace is absent, not zero, and MUST NOT
   * read as "no activity".
   */
  readonly cpuMs?: number;
};

/**
 * The default idle ceiling — ten minutes. curator's guideline was 5–10 minutes; the
 * upper end is taken deliberately. The cost of the two errors is asymmetric here:
 * a missed stall wastes the rest of the wall clock, while a false stall kills a
 * live session and burns one of the three attempts on the pair. Ten minutes of a
 * session producing NOTHING — no output, no file, no commit, no CPU — is not a
 * pause any healthy run of ours has ever taken.
 */
export const DEFAULT_IDLE_MS = 600_000;

/**
 * The watch state: the last trace seen to differ and WHEN it did. Kept as data
 * (rather than a counter of quiet polls) so the verdict does not depend on the
 * poll interval — a wrongly set `--poll` must not shorten or lengthen the ceiling.
 */
export type IdleWatch = {
  readonly trace: ActivityTrace;
  /** The moment the trace last changed — the start of the current silence. */
  readonly sinceMs: number;
};

/**
 * Comparison of two snapshots. A trace that could NOT be measured (`cpuMs`
 * undefined on either side) is not counted as a change: absence of a measurement
 * is not evidence of either life or death, and treating it as a difference would
 * make every poll look like activity on a platform without /proc.
 */
export const traceChanged = (before: ActivityTrace, after: ActivityTrace): boolean => {
  if (before.logBytes !== after.logBytes) return true;
  if (before.worktree !== after.worktree) return true;
  if (before.cpuMs === undefined || after.cpuMs === undefined) return false;
  return before.cpuMs !== after.cpuMs;
};

export const startWatch = (trace: ActivityTrace, nowMs: number): IdleWatch => ({
  trace,
  sinceMs: nowMs,
});

export type IdleStep = {
  readonly watch: IdleWatch;
  /** How long the session has been producing nothing, in milliseconds. */
  readonly quietMs: number;
  /** The silence has exceeded the ceiling — the session is considered stuck. */
  readonly stalled: boolean;
};

/**
 * One step of the watch: a fresh snapshot in, the verdict and the new state out.
 * `idleMs <= 0` switches the detector OFF entirely (never stalled) — the honest
 * way to say "do not use this ceiling" without a second flag beside it.
 */
export const idleStep = (input: {
  readonly watch: IdleWatch;
  readonly trace: ActivityTrace;
  readonly nowMs: number;
  readonly idleMs: number;
}): IdleStep => {
  const { watch, trace, nowMs, idleMs } = input;
  if (traceChanged(watch.trace, trace)) {
    return { watch: startWatch(trace, nowMs), quietMs: 0, stalled: false };
  }
  const quietMs = Math.max(0, nowMs - watch.sinceMs);
  return { watch, quietMs, stalled: idleMs > 0 && quietMs >= idleMs };
};

/** The silence in a human line — the CLI prints it beside a `stalled` release. */
export const describeQuiet = (quietMs: number): string =>
  `no traces of activity for ${Math.round(quietMs / 1000)}s`;
