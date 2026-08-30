/**
 * THE VOCABULARY OF PAIR STATES — one place where a machine state becomes a sentence a
 * human reads (thread 063, john's word of 2026-08-30: "why is all this called
 * `draining`? revise the state system completely; give it a million statuses, so that
 * everything is called by its own name").
 *
 * THE DEFECT THIS FIXES IS NOT SPELLING. `draining` means "the role WORKS after it has
 * sent its first message" — `handoff-detected` is written by the FIRST outgoing message,
 * and rule 11 of the root CLAUDE.md tells the role to report as it goes and carry on. So
 * a state named "burning down" describes normal work at full speed, and the price was
 * paid three times in one day by the reader of the frame: twice john came to sort out a
 * "hung" role that was working, and once a chat curator built a false diagnosis on the
 * word and handed him a wrong number that a whole statement of work then stood on.
 *
 * TWO THINGS ARE SEPARATED HERE AND MUST STAY SEPARATED:
 *  - the DATA word (`running`/`draining`/`waiting`/`released`/`stopped`, and the eleven
 *    release reasons) — it lives in the journal and in the digest a box publishes about
 *    itself, it is append-only, and it is NOT renamed. Renaming it would make old
 *    journals unreadable and would buy nothing: nobody reads a journal to find out what a
 *    role is doing right now;
 *  - the DISPLAY word — this file. Every frame a human reads goes through it, which is
 *    the other half of the fix: until now `status` translated `draining` (thread 019) and
 *    the two OTHER renderers of the same fact — the parallelism block of the frame and
 *    the line about a neighbouring box — printed the raw machine word beside it. That is
 *    exactly the list john read the word in.
 *
 * THE ACCEPTANCE CRITERION IS NOT A TEST, it is john's: a person seeing the frame for the
 * first time understands what is going on without asking. Hence every phrase here answers
 * "what is the role DOING", in that order — the verb first, the cause after the dash —
 * and never names a mechanism the reader would have to look up.
 *
 * WHAT IS STILL MISSING is written down and not silently implied: the inventory of the
 * whole model, the states that are conflated today and the ones that do not exist yet,
 * live in `docs/state-model.md`. This file closes the naming of what the LEASE knows;
 * the states the lease has never been told about (a role held back by a quota shelf, a
 * turn frozen on a PR, a run doing self-service) are named there as absent.
 */

import type { ReleaseReason } from "./journal.js";
import type { LeaseLifecycle, LeaseView } from "./lease.js";

/**
 * WHAT AN ALIVE PAIR IS DOING. Three states, three different things, and the middle one
 * is the whole point of this file.
 *
 * `running` — the run is up and has NOT written into its thread yet. "Nothing reported
 * yet" and not merely "working": the difference from the next line is precisely whether
 * the thread has heard from it, and a reader who cannot see that difference cannot tell a
 * run that is about to deliver from one that has already delivered and is tidying up.
 *
 * `draining` — the turn HAS been passed and the session is still working, inside the same
 * window, until its process exits by itself. The old word said "shutting down" about a
 * role doing full-speed work.
 *
 * `waiting` — the run asked a human a question and parked on the answer (R19). It is
 * alive on purpose, its work clock is frozen, and the thing it waits for is a PERSON —
 * said out loud because the frame's other waits are for machines.
 */
const ALIVE_WORD: Readonly<Record<"running" | "draining" | "waiting", string>> = {
  running: "working — nothing reported yet",
  draining: "working on — already reported, turn passed",
  waiting: "parked — waiting for a person to answer",
};

/**
 * WHY EACH ENDING IS ITS OWN SENTENCE (john: "a million statuses"). The frame used to
 * print the bare enum in brackets — `(exited-without-handoff)`, `(supervisor-gone)` — and
 * those two look like the same class of thing to anyone who has not read `journal.ts`,
 * while they call for opposite actions: the first is the pair's own break and spends an
 * attempt, the second is the box killing the round and spends nothing.
 *
 * The phrases are grouped by what the reader must DO, and that is visible in the verb:
 * `finished` — nothing; `cut off` — the run had its window taken or overrun, look at the
 * cause; `quit`/`died` — the session itself went away; `stopped` — a hand did it.
 */
const RELEASE_WORD: Readonly<Record<ReleaseReason, string>> = {
  /** The work was done and the turn passed — the only ending that needs no reader. */
  completed: "finished — the turn was passed",
  /** A hand stopped it; the trace names who (a `stop` event with `by`). */
  forced: "stopped by hand",
  /** The pair's own break, and the one the attempt ceiling was built to catch. */
  "exited-without-handoff": "quit without passing the turn — nobody was handed the work",
  /** The box killed the round, not the pair: a daemon stop, a self-restart, an adoption. */
  "supervisor-gone": "lost — the supervisor died under a session that was working",
  /** It was working and did not fit: the answer is a wider window, not an investigation. */
  timeout: "cut off — the work window ran out while it was still working",
  /** No traces at all for longer than the idle ceiling: the opposite diagnosis to timeout. */
  stalled: "cut off — went silent, no traces of any work",
  /** R19, ending 1: the question stands in the thread and nobody came. Nobody's failure. */
  "input-timeout": "closed — the question stood unanswered past its ceiling",
  /** R19, ending 2: the session died while parked; the question is still in the thread. */
  "exited-while-waiting": "died while parked on a person's answer",
  /** Nothing writes it today; kept because journals are append-only and must stay readable. */
  exhausted: "not raised — the attempt ceiling had already been reached",
  /** One resource of the whole box. Never the pair's own cause, never a spent attempt. */
  "quota-exhausted": "cut off — the vendor's window shut on this box",
  /** The box's credentials, not this role's: it dies in seconds having spent nothing. */
  "auth-failed": "cut off — this box could not authenticate",
};

/**
 * THE STATE, IN ONE PHRASE. A `LeaseView` is not required — the digest of a NEIGHBOURING
 * box carries its leases as plain strings off the wire (`instances.ts`), and that line is
 * one of the three places the raw word used to leak into a human frame. So the entry
 * point takes the lifecycle alone and the reason separately, optional.
 *
 * An unknown word is RETURNED AS IT CAME rather than swallowed or replaced by a guess:
 * these strings can arrive from another box running another version, and a frame that
 * silently prints "working" about a state it does not know is the exact failure this file
 * exists to end.
 */
export const stateWord = (state: LeaseLifecycle | string, reason?: LeaseView["reason"]): string => {
  if (state === "running" || state === "draining" || state === "waiting") {
    return ALIVE_WORD[state];
  }
  if (state === "released") {
    if (reason === null || reason === undefined) return "released";
    // `graceful`/`forced` are `stop` modes and cannot reach a release; the guard is here
    // because the view's `reason` field carries both unions in one type.
    return RELEASE_WORD[reason as ReleaseReason] ?? `released (${reason})`;
  }
  if (state === "stopped") {
    if (reason === "graceful") return "stopped — the daemon stood down and closed it";
    if (reason === "forced") return "stopped by hand";
    return "stopped";
  }
  return state;
};

/**
 * HOW MUCH IS LEFT — the second half of john's requirement 5: today the frame shows a
 * word and a deadline, and a reader has to subtract two ISO stamps in their head to learn
 * whether a role has forty minutes or four. One phrase does it instead.
 *
 * WHICH CLOCK is the same choice `foldLeases` already makes: a parked lease is judged by
 * the wait's own ceiling, everything alive by the work window, and a terminal lease by
 * nothing at all — a deadline on a finished run is history, and printing "3m left" beside
 * it would be the frame lying in the reader's favour.
 *
 * The unit is minutes, and under a minute says so in words rather than rounding to `0m`:
 * `0m left` reads as "no time at all" when it means "less than a minute".
 */
export const timeLeftWord = (view: LeaseView, now: Date): string => {
  if (view.state !== "running" && view.state !== "draining" && view.state !== "waiting") return "";
  const clock = view.state === "waiting" ? view.waitDeadline : view.deadline;
  if (clock === null) return "";
  const ms = Date.parse(clock) - now.getTime();
  if (Number.isNaN(ms)) return "";
  const what = view.state === "waiting" ? "the wait" : "its window";
  const minutes = Math.floor(Math.abs(ms) / 60_000);
  if (ms < 0) return `${minutes}m past the end of ${what}`;
  if (minutes === 0) return `under a minute left of ${what}`;
  return `${minutes}m left of ${what}`;
};
