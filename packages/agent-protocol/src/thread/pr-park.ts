/**
 * A PARK ON A MERGE THAT NOTHING WATCHES (thread `030-notify-parking-accuracy`, defect Д-3).
 *
 * `parked-on: pr:N` has EXACTLY ONE lift, and it is not the state of the pull request: it is a
 * MESSAGE carrying the header `merged-pr: N`, written anywhere in the mail (`mergedPrs`). No
 * part of this package asks GitHub whether N is closed or merged — not the door, not the tick,
 * not the courier. The form reads as "it will unfreeze itself when the merge lands", and that
 * is true only for a merge the circuit itself announces.
 *
 * IT WAS MEASURED (a consumer, 2026-08-21): a thread was frozen on `pr:366` at 08:23Z with the words
 * "разморозится сам, когда #366 закроется" in its own body; #366 was merged at 08:31Z and the
 * event landed in ANOTHER thread as prose, with no `merged-pr` header anywhere. The park stood
 * 8 hours, until a human woke it by hand at 16:36Z — and the cost was a ready head standing
 * idle for those hours while every reader of the feed saw a thread "behaving as intended".
 *
 * THE REPAIR IS THE CHEAP ONE OF THE TWO curator named, and it is deliberate: no watcher of PR
 * state is added (that is a poll of the vendor on every tick, for a park that legitimately
 * lasts days), and the form is not forbidden (it is the right form when the merge notifier is
 * the one announcing). What changes is that the door STOPS BEING SILENT about the condition:
 * the writer is told, at the moment of parking, what exactly will lift it and what will not.
 * A door that lets a promise through without naming its condition is the "molчаливое «само»"
 * the statement of work called worse than either alternative.
 */

/**
 * WHAT THE DOOR SAYS BACK when a park on `pr:N` is declared — the condition of the lift, in
 * words, at the moment the promise is made.
 *
 * A note and not a refusal: the park is legal and often right. It is printed by the door on
 * `new-message`/`new-thread` exactly as the `run:` note is, and it is pure here so that its
 * wording is a test rather than a screenshot.
 */
export const describePrPark = (pr: number): string =>
  `the park on PR #${pr} lifts on ONE thing and nothing else: a message carrying 'merged-pr: ${pr}' in its header, anywhere in the mail. NOTHING WATCHES THE STATE OF #${pr} — closing or merging it in GitHub does not unfreeze this thread, and a merge announced in prose does not either (thread 030: 8 hours of a frozen thread and an idle head). If the merge notifier does not write that header, somebody must write here to lift it`;
