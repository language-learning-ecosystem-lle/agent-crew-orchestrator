/**
 * A LETTER INTO A THREAD THAT IS ALREADY PARKED MUST SAY SO (thread 058, point (B.3) of
 * curator's statement of work, on john's word of 2026-08-30 ~15:39Z).
 *
 * THE MEASURED CASE (LLE mail, thread 110, 2026-08-30):
 *
 * | time | event |
 * | --- | --- |
 * | `14:24:19Z` | dev-speech is raised by the merge of its PR |
 * | `14:24:50Z` | curator, in its own live session, asks john a question and PARKS the thread |
 * | `14:26:53Z` | dev-speech writes its report — into the standing park, saying nothing of it |
 *
 * Nothing here broke a rule: the pair `dev-speech × 110` had its own reason to be raised, and
 * the park is written on the THREAD while the scheduler works on PAIRS. What it cost was paid
 * three times over — john's call showed the last line (a report) instead of the question the
 * thread was frozen on; the curator of the chat built an answer on that last line and spent
 * three messages restoring the order; and the next role raised there would read "the last
 * message" exactly the same way.
 *
 * WHAT THIS DOOR DOES AND WHAT IT DELIBERATELY DOES NOT. It refuses a letter that neither
 * ADDRESSES the standing park nor NAMES it, and the refusal carries the park in full — what it
 * waits for, since when, whose turn it was declared on, and the question in the words it was
 * asked in. It changes NOTHING about what lifts a park: `parkingOf` is read, not re-decided.
 * The narrowing of the lift itself (a letter written by a session raised BEFORE the park was
 * declared should perhaps not lift it) is a norm of john's — thread 042, `PROTOCOL.md` — and is
 * carried to him in thread `067-park-lift-narrowing`, not decided here.
 *
 * WHY A REFUSAL AND NOT A WARNING. `--write` makes the file, the commit and the push one
 * action, so a warning printed after it is a remark about a letter that is already in an
 * append-only feed — the incident letter would have gone out unchanged, which is exactly the
 * thing the point says must not happen. The refusal is what makes "the letter must name it"
 * true of the letter and not only of the shell it was typed in.
 *
 * WHY IT FIRES AT MOST ONCE PER PARK. A park is lifted by the next message that does not
 * repeat it (`parkingOf`), so the only letter this door can ever stop is the FIRST one after
 * the declaration — which is the incident letter, and no ordinary traffic behind it.
 */
import type { Parking } from "./thread.js";

export type ParkSeenVerdict =
  | { readonly ok: true; readonly note?: string }
  | { readonly ok: false; readonly reason: string };

/** The value the standing park is written with — what `--parked-on` would have to repeat. */
const parkValue = (parking: Parking): string =>
  parking.kind === "person"
    ? (parking.person ?? "")
    : `${parking.kind === "run" ? "run" : "pr"}:${parking.pr}`;

/** What the park is waiting for, in words a reader of the refusal can act on. */
const describePark = (parking: Parking): string => {
  if (parking.kind === "person") return `a decision of ${parking.person}'s`;
  return parking.kind === "run"
    ? `the round running on PR #${parking.pr}`
    : `the merge of PR #${parking.pr}`;
};

/** The one thing that ADDRESSES this park — the field that carries what it waits for. */
const addressOf = (parking: Parking): string => {
  if (parking.kind === "person") return `--delivers ${parking.person}`;
  return parking.kind === "run"
    ? `--verdict <approve|needs-fixes> --pr ${parking.pr}`
    : `--merged-pr ${parking.pr}`;
};

/**
 * DOES THIS MESSAGE SAY ANYTHING ABOUT THE PARK STANDING ON THE THREAD.
 *
 * `parking` is what {@link Parking} the reader of the feed sees NOW — `undefined` when nothing
 * is frozen, and then there is nothing to say and nothing to refuse.
 *
 * Three ways to pass, and each is a different statement rather than a way of clicking OK:
 *  · CARRY WHAT IT WAITS FOR — `--delivers <person>` / `--merged-pr N` / `--verdict … --pr N`.
 *    These are the fields that lift the park by themselves; a letter carrying one is the answer
 *    arriving, and it names the park by construction;
 *  · CARRY THE PARK FORWARD — `--parked-on <the same value>`: the question still stands and this
 *    letter is a report beside it;
 *  · NAME THE LIFT — `--park-lifted <the same value>`: the park is over and the letter says which
 *    one it ends. The value must MATCH the standing park: a flag that takes any word would be a
 *    door that teaches its reader to type past it.
 */
export const judgeParkSeen = (input: {
  readonly thread: string;
  readonly parking: Parking | undefined;
  readonly parkedOn?: string;
  readonly delivers?: string;
  readonly mergedPr?: number;
  readonly verdictPr?: number;
  readonly lifted?: string;
  /**
   * WHY THE PARK IS UNKNOWN, when the feed of the thread could not be read at all — the
   * reason in the words of the reader (`loadThread`), which already name the cure.
   * `undefined` means the feed WAS read and `parking` is what it says.
   */
  readonly unreadable?: string;
}): ParkSeenVerdict => {
  const { parking, lifted } = input;
  // A DOOR THAT COULD NOT LOOK SAYS SO — it does not report its own blindness as "clear"
  // (thread 058, finding 11 of the review of #170, measured by curator against `main`).
  // The reader of the feed can fail on a thread that IS there: half a migration
  // (`messages/` without `_meta.md`), a message file nobody can parse. The letter still
  // goes out — a refusal built on a feed nobody could parse names the writer nothing they
  // can fix, and the mail must stay writable while it is being repaired. What must not
  // happen is the silent answer "nothing is parked", because that is the very class this
  // point exists against: not "refuse at any cost" but NEVER BE SILENT ABOUT WHAT WAS NOT
  // CHECKED. The note is printed before the write and says which of the two it is.
  //
  // It comes FIRST, before the stale `--park-lifted` note below: with the feed unread we
  // do not know that the park is gone, and "it was lifted before this write" would be a
  // second sentence stating as fact the thing nobody could establish.
  if (input.unreadable !== undefined) {
    return {
      ok: true,
      note: `the park standing on '${input.thread}' could NOT be checked — the feed of this thread did not read: ${input.unreadable}. This is not "nothing is parked", it is "nobody could tell": THIS door does not stop the letter, so it may be landing into a standing park. Repair the thread and re-read it`,
    };
  }
  if (parking === undefined) {
    if (lifted === undefined) return { ok: true };
    // A STALE `--park-lifted` IS A NOTE, NOT A REFUSAL — and the reason is this thread's own
    // subject: two roles write into one thread at once, so the park a session read may be
    // lifted by somebody else between the reading and the write. The letter is still the one
    // the writer meant to send; what is wrong is only the writer's picture of the feed, and
    // saying so is cheaper than making them re-run the command to learn it.
    return {
      ok: true,
      note: `--park-lifted '${lifted}': nothing is parked on '${input.thread}' any more — the park was lifted before this write (somebody wrote into the thread first). The message is sent as it is`,
    };
  }

  const value = parkValue(parking);
  if (lifted !== undefined && lifted !== value) {
    return {
      ok: false,
      reason: `--park-lifted '${lifted}' — the park standing on '${input.thread}' is '${value}' (${describePark(parking)}, since ${parking.since}). Name the park you are ending, or re-read the thread: a lift declared about another park says nothing about this one`,
    };
  }
  if (lifted === value) return { ok: true };
  if (input.parkedOn === value) return { ok: true };
  if (parking.kind === "person" && input.delivers === parking.person) return { ok: true };
  if (parking.kind === "event" && input.mergedPr === parking.pr) return { ok: true };
  // A ROUND IS OVER WHEN ITS PR IS MERGED TOO (`parkingOf` reads it that way): the verdict it
  // waited for cannot arrive after the button, so an announcement of that merge addresses the
  // park just as the verdict does.
  if (parking.kind === "run" && (input.verdictPr === parking.pr || input.mergedPr === parking.pr))
    return { ok: true };

  const holder = parking.holder === undefined ? "" : `, declared on ${parking.holder}'s turn`;
  const question =
    parking.question.trim() === "" ? "" : ` The question it stands on: "${parking.question}".`;
  return {
    ok: false,
    reason: `thread '${input.thread}' is PARKED behind ${describePark(parking)} since ${parking.since}${holder}, and this message says nothing about it.${question} A letter written into a standing park reads as if the thread were alive — measured on 2026-08-30 (LLE thread 110): the report of a session raised 31 seconds before the park landed two minutes after it, and the call to the human showed that report instead of the question the thread was frozen on. Say what THIS letter does about the park: '${addressOf(parking)}' if it carries what the park waits for (that is what lifts it), '--parked-on ${value}' if the question still stands and your letter is a report beside it, or '--park-lifted ${value}' if the park is over and you are naming it as you write`,
  };
};
