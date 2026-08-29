/**
 * A PARK ON A PERSON WHO IS NOT BEING ASKED ANYTHING (thread `050-park-only-on-a-question`).
 *
 * Until 2026-08-29 a park on a human together with `expects: none` was the LAWFUL "park as a
 * mode" — a line of state that calls nobody (decision of john 2026-08-04, thread 023; the door
 * had refused the pair from 034 until then). What that form actually bought was measured on
 * 2026-08-29 by the person it was pointed at, and the word is his: «от меня здесь не нужно
 * АБСОЛЮТНО НИЧЕГО — и эта штука встаёт парковкой на меня. Что за бред».
 *
 * THE DEFECT IS NOT THE SILENCE, IT IS THE ADDRESS. A park as a mode is used when the work
 * cannot go on for an INTERNAL reason — waiting for somebody else's event (`045`: a day of field
 * in another thread), waiting for a condition checked after the fact (`035`: the first real round
 * of review) — and it then declares the thread to be standing on a human who is not a party to
 * that pause at all. He can neither decide it, nor speed it up, nor close it. Ten such threads
 * stood at once and he read them in one list: every false one devalues the rest and spends his
 * attention on "and what is wanted from me here?". It is the harm of a false alarm from a
 * watchman, only quieter.
 *
 * WHY THE HEADER IS ENOUGH TO TELL THEM APART, AND THE BODY IS NOT READ. "A decision, a word or
 * an action is required of him" is exactly what `expects` already declares: `answer` asks for a
 * word, `ack` asks for an acknowledgement — either is a call. `expects: none` says in the writer's
 * own hand that nothing is wanted, and a park on a person is then a call with nothing to answer.
 * Reading the TEXT for a question mark was the other candidate in the statement of work and is
 * refused for the reason norm 020 refuses it everywhere else: the net is built on the fields of
 * the header, prose-matching would guess, and a guess here turns a lawful pause into a call (or
 * back) with nobody able to say which. The source of truth stays the DECLARATION, as it is for
 * `delivers` and for `verdict:`/`pr:`.
 *
 * WHAT IS DELIBERATELY NOT TOUCHED:
 *  · the EVENT parks (`pr:N`, `run:N`) — they call nobody by construction, and `expects: none`
 *    beside them is the everyday shape of "handed the turn over and parked behind the round";
 *  · the LIFTS of a park on a person (`delivers`, `status: closed`) and the turn it is declared
 *    on (thread 042) — this door judges only whether the park may be WRITTEN;
 *  · what a role should do when it has an internal pause and no form for it: that is a defect of
 *    the mechanism and is named as one (the refusal says so), not papered over with a human.
 */

import type { Expects } from "./message.js";

/** The verdict of the door: written, or refused with a reason that names the exits. */
export type HumanParkVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** An event park names a merge or a round, not a participant — `parkedOnFrom` uses the same shape. */
const PARK_EVENT = /^pr:\d+$|^run:\d+$/;

/**
 * MAY THIS PARK ON A PERSON BE WRITTEN — the check at the writing door, on both commands of the
 * pair (the lesson of 075: a rule held by one door and swallowed by the other costs an empty tick).
 *
 * Pure, so the WORDING is testable without a checkout: a refusal that does not name the exit is a
 * refusal the role cannot repair, and the exits here are three plus one — say what is wanted of
 * the person, park behind the event instead, hand the turn to whoever continues it, or, if the
 * pause has no form at all, say THAT in the thread instead of addressing a human.
 */
export const judgeHumanPark = (input: {
  readonly parkedOn?: string | undefined;
  readonly expects: Expects;
}): HumanParkVerdict => {
  const parkedOn = input.parkedOn;
  if (parkedOn === undefined) return { ok: true };
  if (PARK_EVENT.test(parkedOn)) return { ok: true };
  if (input.expects !== "none") return { ok: true };
  return {
    ok: false,
    reason: `'--parked-on ${parkedOn}' with '--expects none' declares the thread to be standing on a person and asks him for nothing — a call with nothing to answer, which he can neither decide, nor speed up, nor close (thread 050, word of john 2026-08-29: «от меня здесь не нужно АБСОЛЮТНО НИЧЕГО — и эта штука встаёт парковкой на меня»). Such parks mix into one list with the real questions and spend the attention that the real ones need. A park on a person is declared ONLY when a decision, a word or an action is required OF HIM. The exits, in the order they are usually right: '--expects answer' (or 'ack') if something IS wanted of ${parkedOn} — then say it in the body; '--parked-on pr:<number>' / 'run:<number>' if the pause is a merge or a round of CI, which calls nobody; '--waiting-on <role>' with no park at all if somebody else continues the work. And if the pause is none of these — waiting for an event in ANOTHER thread, or for a condition that can only be checked afterwards — that is a MISSING FORM, and the protocol wants it named in the thread as a defect of the mechanism, not substituted with a human`,
  };
};
