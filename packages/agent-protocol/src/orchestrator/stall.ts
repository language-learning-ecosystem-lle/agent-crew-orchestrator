/**
 * THE CIRCUIT THAT STANDS STILL WHILE EVERY OUTSIDE SIGN SAYS IT WORKS (thread
 * `180-selfheal-leaves-the-workspaces-behind`, curator's §4(б) of 2026-09-09).
 *
 * WHAT WAS MEASURED — twice in one hour, on two boxes, for two different reasons:
 *
 *  · `~12:25Z`, the consumer contour. The pin landed by itself and the daemon restarted
 *    itself onto `0.2.14`; the role worktrees stayed on `0.2.13`, so the workspace door
 *    refused every planned launch — `skipped — its workspace is not usable: … runs
 *    'agent-protocol' 0.2.13, the home checkout … ` — tick after tick, for ~30 minutes;
 *  · `~13:15Z`, this contour. The config declared protocol version 27 and the running
 *    build knew 26, so the planner found nothing launchable at all — `no candidate is
 *    launchable: all 8 were skipped` — for ~20 minutes.
 *
 * BOTH TIMES THE QUEUE WAS FULL, no pair was parked, the unit was `active`, and the only
 * trace was a line in `daemon.log`. Both times a human found it by asking. NOBODY RANG.
 *
 * THE CLASS IS NOT THE CAUSE. There were two causes inside one hour and there will be
 * more; what they share is the shape — THE TICK HAD SOMEBODY TO RAISE AND RAISED NOBODY,
 * and the next tick did the same. That shape is what this module counts, so a third cause
 * nobody has met yet rings on the day it appears instead of on the day it is written down.
 *
 * WHY NOT THE DOOR. The refusals are RIGHT: a role whose package is older than the box
 * would write a form the box no longer parses. Nothing here weakens a door, delays a tick
 * or reorders a queue — it is a COUNTER and a PREDICATE beside the loop, on the pattern of
 * `outage.ts` and for the same reason: the worst it can do is stay quiet.
 *
 * WHY THE RUN IS KEYED BY THE REFUSALS AND NOT BY "there is a stall". A stall that ends
 * and starts again with a different fault is a NEW event and is due a second call; a stall
 * that goes on saying the same thing is one event and rings once. So the run carries a
 * FINGERPRINT of what the tick refused with, and any change of it starts the run over —
 * the rule the `gh` outage beside it already follows.
 *
 * AND THE FINGERPRINT IS A SET, NOT A SENTENCE. Curator's §4(б) names the class as "every
 * candidate skipped by ONE AND THE SAME reason", and the first incident shows why a
 * verbatim key cannot express that: the two refusals differed by exactly the role name
 * inside them (`the workspace of 'curator' …` / `the workspace of 'dev-core' …`) and were
 * the same fault. So each reason is normalised — its quoted parts, which is where the
 * names and the paths live, are collapsed — and the run is keyed by the SET of what is
 * left. Two roles refused by one cause fold to one entry; two genuinely different causes
 * stay two, and the stall is still a stall.
 *
 * WHY A TICK IS THE UNIT. What is being counted is "the loop went round and lifted
 * nobody", an event of the loop rather than of the clock: a daemon that is down is not
 * stalling, and a minute-based threshold would ring for one.
 *
 * WHAT IS NOT A STALL, and each of these is a tick the counter deliberately drops on the
 * floor rather than one it forgets to handle:
 *
 *  · A TICK WITH NO CANDIDATES. An empty queue is an idle circuit, which is the normal
 *    state of a night. Nothing was refused, so there is no evidence either way and the run
 *    is HELD as it stands — neither extended nor cleared. (The same third answer
 *    `foldGhOutage` needed, and for the same reason: a lull in the middle of a stall must
 *    not restart its count.)
 *  · A TICK OF A MOVING CIRCUIT. Whatever else it refused, something is in flight — a role
 *    at a ceiling while another works is the design, not a standstill. The run is CLEARED.
 *  · A TICK THAT WITHHELD ON PURPOSE — a repair handover, a drain, launches disabled, a
 *    quota pause. The daemon is doing the thing it decided to do and it says so itself;
 *    counting it would ring on every restart of the box.
 */

/** The run of unlifted ticks in force now — a standstill as a state, not as a tally. */
export type Stall = {
  /**
   * What the tick refused with, normalised and deduplicated, in order — the fact the alarm
   * quotes. One entry when one cause refused every candidate, which is the measured case.
   */
  readonly reasons: readonly string[];
  /** When this run began: the first tick that lifted nobody for THESE reasons. UTC to the second. */
  readonly since: string;
  /** How many consecutive ticks have lifted nobody, this one included. */
  readonly ticks: number;
  /** How many candidates the last such tick had — "full queue, nothing raised" in one number. */
  readonly candidates: number;
  /** The most recent unlifted tick — what tells a live stall from a stale file. */
  readonly last: string;
};

/**
 * HOW MANY UNLIFTED TICKS MEAN "THE CIRCUIT IS STANDING", rather than a moment of bad luck.
 * Three: with the daemon's default 30-second tick that is a minute and a half, which is
 * past any single slow door, lock or clone — and far inside the twenty minutes that were
 * the SHORTER of the two measured standstills. The threshold is printed beside the count
 * everywhere the count is printed, which is what makes the number legible without this file.
 */
export const STALL_TICKS = 3;

/** How many reasons are kept. Beyond this the list stops being evidence and becomes a log. */
const REASONS = 5;

/** How much of one reason is kept — enough to recognise the fault, not the whole refusal. */
const REASON = 240;

/**
 * ONE REFUSAL → ITS CLASS. The quoted parts of a refusal are where this package puts the
 * things that differ between two candidates of one fault — the role, its worktree, the
 * package name — so they are collapsed and everything else, the version numbers included,
 * is kept: `0.2.13` becoming `0.2.14` IS a different fault and must start a new run.
 */
const classOf = (reason: string): string => {
  const flat = reason
    .replace(/'[^']*'/g, "'…'")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= REASON ? flat : `${flat.slice(0, REASON)}…`;
};

/** The classes of one tick's refusals, deduplicated, order kept, capped — the run's key. */
export const stallReasons = (refusals: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  for (const refusal of refusals) {
    const cls = classOf(refusal);
    if (cls !== "") seen.add(cls);
    if (seen.size >= REASONS) break;
  }
  return [...seen];
};

/**
 * ONE TICK'S ANSWER → THE RUN. Pure and total: it never throws and never reads anything.
 *
 * `moving` is the one input that can clear a run, and it is NOT "this tick raised somebody":
 * it is every pair the circuit has in flight — the raises of this tick plus the sessions
 * still running from earlier ones. A box with two roles, one of them mid-session, refuses
 * every other candidate of the queue with "the role is running" on every tick for the hour
 * that session lasts; counting those would ring on the healthiest circuit there is. What
 * makes a standstill is that NOTHING is moving and nothing was lifted.
 */
export const foldStall = (input: {
  readonly previous: Stall | undefined;
  /** How many candidates this tick had in front of it, before any door. */
  readonly candidates: number;
  /** How many pairs the circuit has in flight: this tick's raises plus the sessions still live. */
  readonly moving: number;
  /** The refusals it printed, verbatim — normalised here, not by the caller. */
  readonly refusals: readonly string[];
  /** Was this tick free to raise at all: false for a drain, a repair handover, a disabled box. */
  readonly launching: boolean;
  readonly now: Date;
}): Stall | undefined => {
  if (!input.launching) return input.previous;
  if (input.moving > 0) return undefined;
  if (input.candidates === 0) return input.previous;
  const reasons = stallReasons(input.refusals);
  const stamp = `${input.now.toISOString().slice(0, 19)}Z`;
  const previous = input.previous;
  const same =
    previous !== undefined &&
    previous.reasons.length === reasons.length &&
    previous.reasons.every((reason, index) => reason === reasons[index]);
  return same && previous !== undefined
    ? {
        reasons,
        since: previous.since,
        ticks: previous.ticks + 1,
        candidates: input.candidates,
        last: stamp,
      }
    : { reasons, since: stamp, ticks: 1, candidates: input.candidates, last: stamp };
};

/**
 * THE PREDICATE THAT RINGS, with the threshold handed in for the reason `outageDue` takes
 * one: one unlifted tick is not an event, a run of them is a circuit that has stopped.
 */
export const stallDue = (stall: Stall, threshold: number): boolean => stall.ticks >= threshold;

/** The daemon's own reading of {@link stallDue} — see {@link STALL_TICKS}. */
export const stallAlarmDue = (stall: Stall): boolean => stallDue(stall, STALL_TICKS);

/**
 * The stall in a line, WITH THE THRESHOLD BESIDE THE COUNT and the reasons quoted. The
 * reader of this line has exactly one question — "is anything moving" — and the answer is
 * the first half of the sentence, before any cause.
 */
export const describeStall = (stall: Stall): string =>
  `daemon — nothing has been raised for ${stall.ticks} tick(s) in a row (rings at ${STALL_TICKS}) since ${stall.since}, with ${stall.candidates} candidate(s) waiting: ${stall.reasons.join(" | ") || "no reason was given"}. The queue is full and the box is up — this is a standstill, not an idle circuit`;

/** The state as a file: one JSON object, overwritten — the journal is not a heartbeat log. */
export const renderStall = (stall: Stall | undefined): string =>
  stall === undefined ? "" : `${JSON.stringify(stall)}\n`;

/**
 * The file back into the state. Missing, empty or unparseable reads as NO STALL — the same
 * one-directional degradation the counter itself has: a reader that threw on a corrupt
 * state file would take the tick that reads it with it.
 */
export const parseStall = (raw: string): Stall | undefined => {
  const text = raw.trim();
  if (text === "") return undefined;
  try {
    const value = JSON.parse(text) as Partial<Stall>;
    if (
      !Array.isArray(value.reasons) ||
      value.reasons.some((reason) => typeof reason !== "string") ||
      typeof value.since !== "string" ||
      typeof value.last !== "string" ||
      typeof value.ticks !== "number" ||
      typeof value.candidates !== "number"
    )
      return undefined;
    return {
      reasons: value.reasons as readonly string[],
      since: value.since,
      ticks: value.ticks,
      candidates: value.candidates,
      last: value.last,
    };
  } catch {
    return undefined;
  }
};
