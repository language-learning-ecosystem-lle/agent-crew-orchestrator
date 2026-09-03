/**
 * A PULL REQUEST THAT STOPPED APPLYING TO ITS BASE HAS NO EVENT — this module is the
 * watchman's decision (thread `097-conflict-has-no-signal`, half 2 of the statement of
 * work; curator's answers of 2026-09-03 19:0xZ, msg-010, points 3-5).
 *
 * WHAT IS MISSING IN THE WORLD. GitHub announces a merge, announces the outcome of a run,
 * announces a verdict — and "your branch has diverged from the main line" simply BECOMES
 * TRUE, silently. Nothing falls into the mail, the scheduler learns nothing. So a role
 * finds out only if it comes back for some other reason: `#114` lay conflicting for six
 * days, `#158` for three. The repair is the one the circuit already uses for the outcome
 * of a run and for a merge — a letter into the thread of that pull request, with the turn
 * on its author.
 *
 * WHY THE RULE IS NOT "ANNOUNCE WHAT THE FIELD SAYS". Two measurements decide the shape,
 * and both are in the thread rather than reasoned from:
 *
 *  · `mergeable` is served stale, so ONE ANSWER IS NEVER A VERDICT ({@link judgeMergeability});
 *  · a merge into `main` VOIDS the computed mergeability of every open pull request at
 *    once. Measured either side of the merge of `#249`: three pull requests answered
 *    `MERGEABLE` a minute before, and after it all seven open ones answered `UNKNOWN
 *    UNKNOWN`. A project that merges several times a day therefore spends a large part of
 *    its ticks with NO verdict about anything — "not settled" is the normal state of a
 *    tick, not a cold-start corner.
 *
 * THE THREE RULES THAT FOLLOW, and the third is curator's decision rather than a
 * consequence of the other two:
 *
 *  1. `MERGEABLE` → not settled is NOT a transition. A letter there would be about the
 *     cache, not about the branch, and every letter RAISES A SESSION — that is where the
 *     money in this watchman is, not in the calls to `gh`;
 *  2. not settled → `CONFLICTING` IS a transition: there is a verdict, the state is new,
 *     and its author has something to do about it;
 *  3. THE "ALREADY SAID" MARK IS LIFTED ONLY BY A SETTLED `MERGEABLE`, NEVER BY A
 *     NON-VERDICT. This one is load-bearing because of the second measurement above: were
 *     a non-verdict allowed to lift it, every merge into `main` would wipe the mark off
 *     every pull request at once, and the next settled read would announce every
 *     still-conflicting one again — the "71 runs in a row" noise the statement of work
 *     forbids, arriving not by accident but after EVERY merge.
 *
 * THE PRICE, and why it did not go to john. The first ask is already paid for: the
 * scheduler lists every open pull request once a tick ({@link MergeReadySource.open}), and
 * `mergeable` rides along in that same `--json` for zero extra calls. A second ask is owed
 * only where the cheap answer DISAGREES with what the state remembers ({@link asksOwed}) —
 * the worst tick, the first one after a merge, is one confirming call per open pull
 * request. Measured 2026-09-03: 8 open, ~80 calls an hour at the median tick, against a
 * limit of 5000/hour with 0 spent — 1.6%.
 *
 * WHAT THIS IS NOT. It is not the door in front of the `review` label (`pr mergeable`, in
 * `main` since #249) and does not replace it: the gap between "the label was hung" and
 * "the base moved" was measured at THIRTEEN SECONDS, and no watchman walking in ticks
 * closes that. The door guards the MOMENT of a decision, this guards the IDLE between
 * decisions. And it is not the red-checks signal either (thread `072`) — a different
 * subject, a different letter, a different repair.
 */
import { judgeMergeability, MERGEABLE, type MergeabilityReading } from "../merge/mergeability.js";

/** One open pull request as the cheap half of the tick sees it, plus whatever was asked after. */
export type WatchedPullRequest = {
  readonly number: number;
  readonly headSha: string;
  /** The thread of its description (rule 14) — where the letter goes. */
  readonly thread: string | undefined;
  /** The role of its description — who the turn is passed to. */
  readonly role: string | undefined;
  /** Everything heard about this pull request THIS TICK, in order: one word, or two. */
  readonly samples: readonly (string | null | undefined)[];
};

/** A letter the watchman owes: one pull request, one break, one thread. */
export type MergeabilityLetter = {
  readonly number: number;
  readonly thread: string;
  readonly role: string;
  readonly headSha: string;
  /** The word agreed on, and the whole sequence heard — the letter quotes it. */
  readonly detail: string;
};

/**
 * What the watchman plans this tick. `said` is the WHOLE new mark set, ready to be written
 * back: the caller stores it and hands it in next tick.
 */
export type MergeabilityWatchPlan = {
  readonly letters: readonly MergeabilityLetter[];
  readonly said: readonly string[];
  /** Refusals and skips, in words — this watchman walks on a schedule and has no parent. */
  readonly notes: readonly string[];
};

/**
 * The mark is keyed by the PULL REQUEST and NOT by its head, and that is the difference
 * between "say it once per break" and "say it once per push". A conflicting branch that is
 * pushed to without being rebased is the same break; what ends the break is the branch
 * applying again, which is rule 3 above and nothing else.
 */
export const mergeabilitySaidKey = (pr: number): string => `pr:${pr}`;

const settledWord = (reading: MergeabilityReading): string | undefined =>
  reading.state === "settled" ? reading.mergeable : undefined;

/**
 * WHICH PULL REQUESTS ARE WORTH A SECOND CALL, given the one free answer of the tick and
 * what the state remembers. An absent mark means the state remembers `MERGEABLE`; a
 * present one means it remembers `CONFLICTING`. Where the cheap word already equals what
 * is remembered nothing can change this tick, so nothing is asked — and everything else,
 * `UNKNOWN` included, is asked once more, because a second ask is exactly what turns
 * "not computed" into a verdict.
 */
export const asksOwed = (input: {
  readonly cheap: readonly {
    readonly number: number;
    readonly mergeable: string | null | undefined;
  }[];
  readonly said: readonly string[];
}): readonly number[] => {
  const said = new Set(input.said);
  return input.cheap
    .filter((pr) => {
      const remembered = said.has(mergeabilitySaidKey(pr.number)) ? "CONFLICTING" : MERGEABLE;
      return (pr.mergeable ?? "").trim().toUpperCase() !== remembered;
    })
    .map((pr) => pr.number);
};

/**
 * THE PLAN — pure, and the one place the three rules live.
 *
 * Marks of pull requests that are no longer in the list are dropped, the way the notifier
 * drops the marks of parks that no longer exist (`notify.ts`, `seenEventParks`): a mark
 * held for a closed pull request is a mark that never expires, and the same break in a
 * reopened one would then be silent forever.
 */
export const planMergeabilityWatch = (input: {
  readonly seen: readonly WatchedPullRequest[];
  readonly said: readonly string[];
}): MergeabilityWatchPlan => {
  const said = new Set(input.said);
  const live = new Set(input.seen.map((pr) => mergeabilitySaidKey(pr.number)));
  const letters: MergeabilityLetter[] = [];
  const notes: string[] = [];
  for (const pr of input.seen) {
    const key = mergeabilitySaidKey(pr.number);
    const reading = judgeMergeability(pr.samples);
    const word = settledWord(reading);
    // Rule 1 and rule 3 at once: a non-verdict neither speaks nor forgets.
    if (word === undefined) continue;
    if (word === MERGEABLE) {
      said.delete(key);
      continue;
    }
    if (said.has(key)) continue;
    // A pull request whose description names no thread or no role cannot be written to,
    // and the mark is NOT set: marking it would make the watchman silent about this break
    // for as long as it lasts, which is the failure the whole module exists against. The
    // refusal names the pull request and what is missing (discipline 4 of the role card).
    if (pr.thread === undefined || pr.role === undefined) {
      notes.push(
        `PR #${pr.number} no longer applies to its base (${reading.detail}) — but its description names ${pr.thread === undefined ? (pr.role === undefined ? "neither a 'thread:' nor a 'role:' line" : "no 'thread:' line") : "no 'role:' line"}, so there is nowhere to put the letter and nobody to pass the turn to; nothing was remembered, so this repeats until the description is fixed`,
      );
      continue;
    }
    said.add(key);
    letters.push({
      number: pr.number,
      thread: pr.thread,
      role: pr.role,
      headSha: pr.headSha,
      detail: reading.detail,
    });
  }
  return {
    letters,
    said: [...said].filter((key) => live.has(key)).sort(),
    notes,
  };
};
