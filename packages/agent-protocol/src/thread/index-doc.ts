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

/**
 * THE PAIR KEY — `(role, thread)`, the identity the lease fold is written against. It
 * lives here rather than in `lease.ts` because the mail side now builds a map on the
 * same key, and two spellings of one identity is how they come to disagree.
 */
export const pairKey = (role: string, thread: string): string => JSON.stringify([role, thread]);

/**
 * THE WORKER A RAISED RUN CARRIES — the supervisor puts it into the environment of every
 * session it spawns (`LAUNCH_ENV.worker`) and `provenanceFrom` writes it into the header.
 * It is the only narrowing by provenance available to the second sign below, and it is a
 * narrowing rather than a proof: `claude-code` is also what a person running the tool by
 * hand writes.
 */
const RUN_WORKER = "claude-code";

/**
 * WHAT THE MAIL KNOWS ABOUT DELIVERIES — the two signs, built in one pass (thread 021).
 *
 * `sessions` is the first and sharp one: the run's own id is in the header, so the release
 * event and the message name the same thing. `runMessages` is the second and narrow one,
 * for the messages whose header could not carry that id (see `deliveryMarks`).
 */
export type DeliveryMarks = {
  /** Sessions named by a `session:` header anywhere in the mail (`sessionsThatWrote`). */
  readonly sessions: ReadonlySet<string>;
  /** `pairKey(from, thread)` → epoch ms of every message a RUN's worker wrote there. */
  readonly runMessages: ReadonlyMap<string, readonly number[]>;
};

/** No mail at hand: a fold that only reads the journal judges by neither sign. */
export const NO_DELIVERY_MARKS: DeliveryMarks = { sessions: new Set(), runMessages: new Map() };

/** Sessions alone, in the shape the fold takes — for a caller that has only the set. */
export const marksOfSessions = (sessions: ReadonlySet<string>): DeliveryMarks => ({
  sessions,
  runMessages: new Map(),
});

/**
 * THE SECOND SIGN OF A DELIVERY, and why the first one is not enough (thread 021).
 *
 * `session:` is minted by the vendor and reaches the writing command through a file the
 * supervisor writes once it has parsed the id off the session's own stream. Between the
 * spawn and that line there is a window, and a message written inside it goes out without
 * the field — silently, on purpose (`provenanceFrom`: a run that cannot name its RUN still
 * has a turn to pass, and losing the turn over a provenance field is the worse trade).
 *
 * MEASURED RATHER THAN ASSUMED (2026-08-21): 13 messages of the current header form carry
 * `worker: claude-code` and no `session:`, all of them inside the era in which the field
 * already existed — two in this repository's mail (`005-comms-derived-untracked`
 * 2026-08-18T11:58:31Z, `017-circuit-watchdog` 2026-08-19T12:28:45Z) and eleven in the LLE
 * mail, the latest `042-notifier-down` 2026-08-21T09:19:58Z. So the window is reachable,
 * and a fold judging by the id alone calls every run that lands in it a failed attempt —
 * three of those close the pair.
 *
 * THE SIGN IS NARROW BY FOUR THINGS AT ONCE, because a wide one would swallow the honest
 * `exited-without-handoff` the ceiling exists for: the message is written by a RUN's worker,
 * by the pair's OWN role, into the pair's OWN thread, and stamped INSIDE the lease window of
 * that very run (the fold holds both edges — `acquiredAt` and the release). A session that
 * died silently wrote no such message and still spends its attempt.
 *
 * WHAT IT CANNOT TELL APART, said out loud rather than left to be discovered: a person
 * writing by hand as the role, into that thread, with `--worker claude-code`, inside that
 * run's window, is counted as that run's delivery. That is the price of there being no other
 * mark, and it is narrow — a human writing in the role's place while the role's own run is
 * up is already an anomaly, and what it buys off is a run that did its work being called
 * broken.
 */
export const deliveryMarks = (threads: readonly Thread[]): DeliveryMarks => {
  const runMessages = new Map<string, number[]>();
  for (const thread of threads) {
    for (const message of thread.messages) {
      const { from, worker, date } = message.fields;
      if (worker !== RUN_WORKER) continue;
      // A migrated date-only stamp (`2026-08-21`) parses to midnight and simply falls
      // outside every lease window — history is read, never counted.
      const at = Date.parse(date);
      if (Number.isNaN(at)) continue;
      const k = pairKey(from, thread.id);
      const stamps = runMessages.get(k);
      if (stamps === undefined) runMessages.set(k, [at]);
      else stamps.push(at);
    }
  }
  return { sessions: sessionsThatWrote(threads), runMessages };
};

/**
 * THE THREADS THAT ARE OVER — the other fact the journal does not have (thread 016).
 *
 * The neighbouring categories drop a closed thread AT THE SOURCE: `waitingOnOf` and
 * `parkingOf` return `undefined` on `status: closed`, so `waiting`, `stalled`, `parked`
 * and `frozen` cannot name one by construction. The sixth — the frozen pairs — is folded
 * from the JOURNAL, where a closure leaves no event at all, and so it went on announcing
 * a pair whose thread had been accepted and closed. Forever, at that: only a delivery OF
 * THAT PAIR zeroes the count, every shape of a delivery is written by a run, and a closed
 * thread gets no runs. This set is how a reader of the journal is told.
 */
export const closedThreads = (threads: readonly Thread[]): ReadonlySet<string> => {
  const closed = new Set<string>();
  for (const thread of threads) if (thread.meta.status === "closed") closed.add(thread.id);
  return closed;
};
