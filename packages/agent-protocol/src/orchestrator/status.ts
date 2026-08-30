/**
 * The orchestrator `status` — a readable view of the folded lease (step S0,
 * thread 012). A pure function: the lease has already been folded by
 * `foldLeases`, only formatting happens here. The point of the step is to see
 * both gaps in the data BEFORE any spawn: `overdue` (stuck) and `exhausted` (the
 * attempt ceiling) are called out as explicit marks instead of hiding inside the
 * state column.
 */
import type { LeaseView } from "./lease.js";
import { stateWord, timeLeftWord } from "./state-word.js";
import { describeFreeze, freezeHasTerm } from "./thaw.js";

/**
 * THE COUNT COLUMN, AND WHY IT MAY EXCEED ITS OWN CEILING (thread 023). `attempt 4/3`
 * with nothing beside it contradicts itself: the reader is shown a ceiling and a number
 * over it and left to decide which of the two is a lie. Neither is — a frozen pair is
 * raised once more by a THAW (thread 013), and the run that thaw raises is honestly the
 * fourth of three. Measured, not supposed: on the box's own journal of 2026-08-21
 * `curator×014-merge-model` reached 6/3, and every such moment was a `running` line,
 * which is exactly the state that carries no `⚠ EXHAUSTED` to explain itself.
 *
 * So the number stays as it is and the SILENCE is what gets fixed: past the ceiling the
 * column says why. While the pair is exhausted the flag below already says it in full, and
 * a second sentence on the same line would only compete with it.
 */
const attemptWord = (view: LeaseView): string =>
  view.attempt > view.ceiling && !view.exhausted
    ? `attempt ${view.attempt}/${view.ceiling} (past the ceiling — raised again by a thaw)`
    : `attempt ${view.attempt}/${view.ceiling}`;

/**
 * A mark on a problem state of the pair — what the operator must not miss.
 *
 * `closed`: the pair's thread is over (thread 016). The LINE stays — a frame prints the
 * history of the journal and that history happened — but the MARK goes: `⚠ EXHAUSTED`
 * calls a hand to a pair, and there is no hand to call for a thread nobody will reopen.
 */
const flag = (view: LeaseView, closed: boolean): string => {
  if (view.exhausted) {
    // WHICH FREEZE THIS IS, AND WHETHER IT ENDS BY ITSELF (thread 013). The old line said
    // one thing about two states that need opposite actions from the reader: a substantive
    // exhaustion waits for a person, an external one waits for a clock the box already
    // holds. The words are `describeFreeze`'s and not this file's on purpose — the frame,
    // the courier line and the digest say the same sentence about the same fact.
    const freeze = {
      failureClass: view.exhaustedClass ?? "substantive",
      thaw: view.thawAt ?? null,
    } as const;
    // A CLOSED THREAD IS HISTORY AND READS AS ONE: no ⚠, no "no more attempts", no advice
    // about zeroing a count nobody is going to spend. One sentence, `describeFreeze`'s.
    if (closed) return `  · exhausted (${describeFreeze({ ...freeze, closed: true })})`;
    // "UNTIL THEN" ONLY WHERE THERE IS A "THEN" (thread 016, defect 2). The tail used to be
    // glued on unconditionally, and after #23 gave the terminal branches their own words the
    // half-sentence pointed at a moment its own sentence no longer named.
    return `  ⚠ EXHAUSTED (${describeFreeze(freeze)}) — no more attempts${
      freezeHasTerm(freeze) ? " until then" : ""
    }; what zeroes the count is a DELIVERY OF THIS PAIR (a completed run, a handoff, or a break whose own session signed a message in the mail), and every shape of it is written by a run, see the journal`;
  }
  // WHICH deadline has passed is said out loud, because the two mean opposite things:
  // an overrun of the work window is a session that did not fit, an overrun of a WAIT
  // is a human who has not answered (R19) — and the second one is nobody's failure.
  if (view.overdue && view.state === "waiting") {
    return "  ⚠ THE WAIT EXPIRED — nobody answered within the ceiling, the session is still parked";
  }
  if (view.overdue) return "  ⚠ OVERDUE — the deadline has passed, the lease is still alive";
  return "";
};

/**
 * ONE PAIR, ONE LINE — exported because the TUI highlights the SELECTED line and so
 * needs the lines one at a time, while `renderStatus` below stays their assembly
 * (T-1, thread 019). A second formatter for the same columns is refused on principle:
 * the top panel of the observer and the first section of `status` are the same fact,
 * and two renderers is how they would quietly start to differ.
 *
 * `closed` — this pair's thread is closed (thread 016); it changes the MARK and nothing
 * else. It is a parameter and not a field of the view on purpose: the fold reads the
 * journal, and whether a thread is closed is a fact of the MAIL, which the fold has never
 * been given and must not start needing.
 *
 * `now` — for the "how much is left" phrase (thread 063, john's requirement 5). Optional,
 * and its absence drops the column rather than guessing at the clock: a caller that reads
 * a journal without a moment to judge it against (a test, an offline reader) gets the
 * frame it always did, and nobody is shown a countdown computed from the wrong `now`.
 */
export const renderLeaseLine = (view: LeaseView, closed = false, now?: Date): string => {
  const cols = [
    view.role,
    view.thread,
    // THE STATE AND THE REASON ARE ONE PHRASE (thread 063). They used to be two columns —
    // a lifecycle word at the front and a bare enum in brackets at the back — and between
    // them the reader had to reassemble the sentence the frame already knew. `stateWord`
    // is that sentence, and it is the SAME function the parallelism block and the
    // neighbouring-box line now call: three renderers of one fact, one vocabulary.
    stateWord(view.state, view.reason),
    // The count AND what it is judged against: "attempt 13" left an operator to guess
    // both the ceiling and whether their `--max-attempts` had arrived at all.
    attemptWord(view),
    // WHAT THE DEADLINE MEANS IN MINUTES, beside the stamp rather than instead of it: the
    // stamp is what an operator quotes into a thread, the phrase is what they read.
    // BEFORE the stamp, and that order is load-bearing rather than taste: the observer's
    // top panel cuts this line to the terminal's width (`tui.ts`), and at eighty or a
    // hundred columns the cut lands inside these last columns. What survives a cut must be
    // the half that is READ; the half that is COPIED into a thread is the one to lose.
    now === undefined ? "" : timeLeftWord(view, now),
    view.deadline === null ? "deadline —" : `deadline ${view.deadline}`,
    // The wait's own clock is shown only while it is the one in force: an empty column
    // in every other state would read as "no wait ceiling exists".
    view.waitDeadline === null ? "" : `awaiting input until ${view.waitDeadline}`,
  ]
    .filter((c) => c !== "")
    .join("  ·  ");
  return `${cols}${flag(view, closed)}`;
};

/**
 * State lines for every (role, thread) pair. An empty lease set produces an
 * honest "no active sessions" line rather than empty output: silence is
 * indistinguishable from a failure to read the journal (the P0 lesson), so the
 * absence of sessions is spelled out.
 *
 * `closed` — the ids of the threads that are over, from the mail the caller has already
 * read. Empty by default: a caller with no mail in its hands (a test, a reader pointed at
 * a journal alone) prints the same frame it always did.
 */
export const renderStatus = (
  views: readonly LeaseView[],
  closed: ReadonlySet<string> = new Set(),
  now?: Date,
): string => {
  if (views.length === 0) return "orchestrator: no sessions in the journal";
  return views.map((view) => renderLeaseLine(view, closed.has(view.thread), now)).join("\n");
};
