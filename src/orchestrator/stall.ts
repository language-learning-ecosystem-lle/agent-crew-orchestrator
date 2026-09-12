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
 *  · A TICK WHOSE EVERY REFUSAL IS COVERED — by a session of THAT REFUSAL'S OWN ROLE being
 *    in flight, or by the refusal being one of the declared waits named in
 *    {@link COUNTS_AS_STANDSTILL}. The run is CLEARED: everything that could move, moves.
 *  · A TICK THAT WITHHELD ON PURPOSE — a repair handover, a drain, launches disabled, a
 *    quota pause. The daemon is doing the thing it decided to do and it says so itself;
 *    counting it would ring on every restart of the box.
 *
 * AND "COVERED" IS PER ROLE, NOT PER BOX (curator's §4 of 2026-09-09, the second case of her
 * acceptance). Until this file had the roles it only had a COUNT of what was in flight, and
 * any one session cleared the run: a box with two roles, one of them mid-session for an
 * hour while every candidate of the other was refused at the door tick after tick, stayed
 * silent for that whole hour — and on a box of two roles that is half the circuit standing
 * still behind the other half. A session of `curator` is evidence about `curator` and about
 * nothing else, so a refusal is now covered by a session OF ITS OWN ROLE. The healthy box
 * this used to protect is protected by the same rule, only exactly: the refusals a busy role
 * collects for its own further pairs (`active`, `role-busy`) are its own, and they are
 * covered by the session it is running.
 */

import type { SkipReason } from "./tick.js";

/**
 * ONE REFUSAL OF ONE TICK, with the two facts the fold judges it by beside the sentence.
 *
 * The class is the planner's own {@link SkipReason} and is imported as a TYPE from the
 * planner rather than restated here: a second spelling of that union is a second thing to
 * forget, and it is the forgetting this module is written against.
 *
 * `role` is what makes "covered" a per-role question rather than a per-box one; `reason` is
 * the planner's class of the refusal when the PLANNER is who refused, and is ABSENT for a
 * refusal of a DOOR — the workspace, the identity, the reachability of the home checkout.
 * That absence is the load-bearing half of {@link COUNTS_AS_STANDSTILL}: every measured
 * standstill of this thread was a door refusing launches the planner had already approved.
 */
export type StallRefusal = {
  /** Whose candidate was refused. A session of THIS role in flight covers it, no other. */
  readonly role: string;
  /** The refusal verbatim, as the daemon printed it — normalised here, not by the caller. */
  readonly text: string;
  /** The planner's class of it; absent means a door refused, and a door is always evidence. */
  readonly reason?: SkipReason;
};

/**
 * WHICH CLASSES OF REFUSAL ARE EVIDENCE OF A STANDSTILL — every one of them named, and the
 * answer for a class nobody has written yet is YES (curator's §4 of 2026-09-09, the first
 * duty of her acceptance).
 *
 * The question this table answers is not "is the refusal right" — they all are — but "would
 * a human, told this and nothing else, have to go and look". A class is exempt only when it
 * fails all three of: nobody was asked for anything; it does not end by itself; it is not
 * already announced by a class of its own. THE DEFAULT IS TO COUNT: a refusal with no entry
 * here is a door refusal, which is what all three measured standstills were, and a NEW
 * `SkipReason` added to `tick.ts` without an entry does not compile — the author of the
 * fourth cause decides what it is, on the day they write it rather than on the day it stands
 * still. That is john's word of 2026-09-12 ((б), "звонить на КЛАСС, а не на причину") in the
 * one place where a class can be forgotten.
 *
 * The nine exemptions, each with the fact that exempts it:
 *
 *  · `active` — the pair IS running: this refusal is the circuit working;
 *  · `role-busy` — the ceiling of that role is full, and the refusal names the live pairs
 *    holding it: a session of the role is in flight, so the per-role cover above already
 *    answers it and the class only makes that answer independent of the cover;
 *  · `box-busy` — the ceiling of the BOX is full. Here the per-role cover is NOT enough and
 *    the class is what saves it: the pairs holding the box may all belong to other roles, so
 *    a refused role can be idle on a box that is working flat out;
 *  · `parked` (R27) — a person or an event was asked, the wait is the protocol, and a park
 *    that goes stale has classes of its own (`frozen`, `stale-event-park`);
 *  · `waiting` (R19) — the session itself asked a question and is ALIVE while it waits;
 *  · `exhausted` — the attempt ceiling. It needs a hand (`thaw`), which is why it would be
 *    tempting to count it — but it is the one class already rung by name AND printed as a
 *    standing count every tick (thread 013), so counting it here would ring twice for one
 *    fact and, worse, would put a legitimately frozen pair in the fingerprint of every
 *    unrelated standstill;
 *  · `quota` — the rate-limit window ends BY THE CLOCK and asks nothing of anybody;
 *  · `auth` — the credentials of that account are refused. It does need a human, and it is
 *    the closest call in this table; it is exempt because the courier already rings on that
 *    exact shelf (`auth`) with the login command in the letter, and a second bell about one
 *    fact is what makes the first one unread;
 *  · `held` — a hand put the hold there and the same hand takes it off; `status` prints it.
 *    A box where a person is working by hand is not a box that stopped.
 */
export const COUNTS_AS_STANDSTILL: Record<SkipReason, boolean> = {
  held: false,
  active: false,
  waiting: false,
  exhausted: false,
  "role-busy": false,
  "box-busy": false,
  parked: false,
  quota: false,
  auth: false,
};

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
 * TWO KEYS → ONE FAULT OR TWO, AND THE COMPARISON IS OF SETS (thread
 * `180-selfheal-leaves-the-workspaces-behind`, curator's finding 9.1 of 2026-09-12).
 *
 * The header of this file says the fingerprint is a SET AND NOT A SENTENCE, and until this
 * function existed the fold compared it POSITIONALLY — `reasons[i] === previous.reasons[i]`
 * over a list `stallReasons` builds in INSERTION order, which is the order of the refusals,
 * which is the order of the candidates in the plan of that tick. That order is not a
 * constant between ticks: it moves with priority, with the age of a turn and with the
 * composition of the queue. So two ticks refused by THE SAME two causes in the other order
 * read as a different fault, the run resets to one, {@link STALL_TICKS} is never reached and
 * the alarm is silent on exactly the standstill it is written for.
 *
 * AND IT IS A SET ON BOTH SIDES, not just on this tick's. This tick's list comes from
 * `stallReasons` and is deduplicated by construction; the previous one comes from a FILE
 * anybody can write, so a repeated entry there must not make `[a, a]` and `[a, b]` read as
 * one fault — hence the sizes are compared as sets and not as lengths.
 */
const sameReasons = (previous: readonly string[], reasons: readonly string[]): boolean => {
  const now = new Set(reasons);
  return now.size === new Set(previous).size && previous.every((reason) => now.has(reason));
};

/**
 * ONE REFUSAL → IS IT EVIDENCE THAT THE CIRCUIT HAS STOPPED. Two questions, in this order:
 * does a session of ITS OWN ROLE cover it, and is its class one of the declared waits.
 */
const standstill = (refusal: StallRefusal, moving: ReadonlySet<string>): boolean =>
  !moving.has(refusal.role) &&
  (refusal.reason === undefined || COUNTS_AS_STANDSTILL[refusal.reason]);

/**
 * ONE TICK'S ANSWER → THE RUN. Pure and total: it never throws and never reads anything.
 *
 * `moving` is what can clear a run, and it is NOT "this tick raised somebody": it is the
 * ROLES the circuit has in flight — the raises of this tick plus the sessions still running
 * from earlier ones. It used to be their COUNT, and the count made one busy role cover the
 * whole box; see the header for what that cost. What makes a standstill is that a candidate
 * was refused, nothing of ITS role is moving, and the refusal is not one of the waits
 * {@link COUNTS_AS_STANDSTILL} names.
 *
 * AND THE FINGERPRINT IS BUILT FROM THE EVIDENCE ONLY, not from everything the tick said.
 * A parked pair joining the queue is not a change of fault, and if it entered the key it
 * would restart the run — the alarm would then go silent exactly on the box whose queue is
 * moving around a standstill, which is every real one of them.
 */
export const foldStall = (input: {
  readonly previous: Stall | undefined;
  /** How many candidates this tick had in front of it, before any door. */
  readonly candidates: number;
  /** The roles the circuit has in flight: this tick's raises plus the sessions still live. */
  readonly moving: readonly string[];
  /** The refusals it printed, with their role and class — normalised here, not by the caller. */
  readonly refusals: readonly StallRefusal[];
  /** Was this tick free to raise at all: false for a drain, a repair handover, a disabled box. */
  readonly launching: boolean;
  readonly now: Date;
}): Stall | undefined => {
  if (!input.launching) return input.previous;
  if (input.candidates === 0) return input.previous;
  const moving = new Set(input.moving);
  const standing = input.refusals.filter((refusal) => standstill(refusal, moving));
  // A TICK THAT RAISED NOBODY AND SAID NOTHING ABOUT ANY OF THEM is the loudest evidence
  // there is and the only one with no role to attribute: there is no refusal to read one
  // off and nothing in flight to cover it. It is kept — with an empty fingerprint, which
  // `describeStall` says out loud — rather than dropped for want of a sentence.
  const silent = input.refusals.length === 0 && moving.size === 0;
  if (standing.length === 0 && !silent) return undefined;
  const reasons = stallReasons(standing.map((refusal) => refusal.text));
  const stamp = `${input.now.toISOString().slice(0, 19)}Z`;
  const previous = input.previous;
  const same = previous !== undefined && sameReasons(previous.reasons, reasons);
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
  `daemon — nothing has been raised for ${stall.ticks} tick(s) in a row (rings at ${STALL_TICKS}) since ${stall.since}, with ${stall.candidates} candidate(s) waiting: ${stall.reasons.join(" | ") || "no reason was given"}. Every one of these refusals is of a role with nothing in flight — this is a standstill, not an idle circuit`;

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
