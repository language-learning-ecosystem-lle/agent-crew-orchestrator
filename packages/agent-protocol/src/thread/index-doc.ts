/**
 * The conversations index as a REFLECTION of the threads (thread 006).
 *
 * `waiting-on` used to be edited by hand by three parties — curator, the dev
 * agents and the merge notifier — and it drifted from the bodies of the threads.
 * Anything edited by hand in several places drifts by construction, so INDEX is
 * not a source but a derived artifact.
 *
 * And a consequence the bash version did not have: since INDEX is derived, **the
 * circuit must not depend on it**. If the index is rebuilt by CI, a failed build
 * would mean the watch and the keeper stopped seeing mail — pain 5 (thread 008)
 * one to one. Hence "is there mail" is computed from the THREADS (`waitingOnOf`),
 * and INDEX stays a display for humans: its drift costs cosmetics.
 */
import { staleRunParks } from "./run-park.js";
import { mergedPrs, parkedOnOf, type Thread, updatedOf, waitingOnOf } from "./thread.js";

const EMPTY = "—";

// The heading is written INTO THE PROJECT ZONE (`INDEX.md` of the mail branch) and
// is therefore deliberately left in the language of that zone: R1 makes the
// package English, but the boundary of R1 is that the project zone is not touched
// — translating it here would rewrite a project artifact on the next rebuild.
const INDEX_HEADING = "# Реестр разговоров";

export const renderIndex = (threads: readonly Thread[]): string => {
  const rows = threads.map((thread) => {
    const waiting = waitingOnOf(thread);
    return `| ${thread.id} | ${thread.meta.participants.join(", ")} | ${thread.meta.status} | ${
      waiting ?? EMPTY
    } | ${updatedOf(thread)} |`;
  });

  return `${INDEX_HEADING}\n\n| id | participants | status | waiting-on | updated |\n|---|---|---|---|---|\n${rows.join(
    "\n",
  )}\n`;
};

/** Threads awaiting a role. This is exactly "is there mail" — computed from the source, not from INDEX. */
export const threadsWaitingOn = (threads: readonly Thread[], role: string): string[] =>
  threads.filter((thread) => waitingOnOf(thread) === role).map((thread) => thread.id);

/**
 * Threads FROZEN (R27), thread id → what freezes them — for whoever decides about raising.
 *
 * The value is the RAW `parked-on`: a person's role id, or `pr:N` for the merge that lifts it
 * (thread 023). Raw rather than already worded, because the readers of this map word it
 * differently — a queue row and a skip line have different room — and they tell the two apart
 * with the one parser (`parkedOnKind`), never with a regex of their own.
 *
 * Deliberately NOT subtracted from `threadsWaitingOn`: a parked thread still holds a turn and
 * is still mail. Hiding it from the mailbox would make the role's own `cli mail` lie about
 * what is on its plate, and would hide the park from the notifier that has to ring the person
 * it is parked on. Only the decision to RAISE is affected, and that decision has its own
 * reader (`planTick`).
 */
export const parkedThreads = (
  threads: readonly Thread[],
  /**
   * THE AGE CEILING OF A `run:` PARK (thread 062, layer 2), when the reader has a clock.
   *
   * Omitted, nothing ages and this function answers exactly as it did — which is what every
   * reader that only DISPLAYS parks wants (the index, the courier). The two readers that decide
   * about RAISING (the daemon's tick and the operator's frame) pass a `now`, and a `run:` park
   * past the ceiling stops appearing here: the pair is no longer frozen and is raised to check
   * the outcome of that run itself. Why only `run:` ages — `staleRunParks`.
   */
  ceiling?: { readonly now: Date; readonly ttlSeconds?: number },
): ReadonlyMap<string, string> => {
  // The merges of the WHOLE mail, computed once: a park on `pr:N` is lifted by an announcement
  // that lands in N's own thread, which is almost never this one (`mergedPrs`, thread 023).
  const merged = mergedPrs(threads);
  const stale = new Set(
    ceiling === undefined ? [] : staleRunParks(threads, ceiling).map((entry) => entry.thread),
  );
  const parked = new Map<string, string>();
  for (const thread of threads) {
    if (stale.has(thread.id)) continue;
    const on = parkedOnOf(thread, merged);
    if (on !== undefined) parked.set(thread.id, on);
  }
  return parked;
};

/**
 * SESSIONS THAT WROTE INTO THE MAIL — the fact the journal does not have (thread 023).
 *
 * A run that carries a question to a human keeps the turn on itself: scalar
 * `waiting-on` (v13) leaves it no other legal shape. Its release therefore reads
 * `exited-without-handoff`, which the attempt ceiling counts as a failure — and the
 * only thing that tells such a run apart from a session that died silently is whether
 * a message signed by that session is in the mail. That is this set, and the fold
 * (`isSelfTurnDelivery`) is the one that judges by it.
 *
 * Read from THE MAIL rather than the journal on purpose: it makes the correction
 * retroactive. Pairs already `exhausted` for delivering by the norm come back the
 * moment a reader hands the fold this set — no hand rewrites the journal, which is
 * append-only and honest about what it saw.
 */
export const sessionsThatWrote = (threads: readonly Thread[]): ReadonlySet<string> => {
  const sessions = new Set<string>();
  for (const thread of threads) {
    for (const message of thread.messages) {
      const { session } = message.fields;
      if (session !== undefined) sessions.add(session);
    }
  }
  return sessions;
};
