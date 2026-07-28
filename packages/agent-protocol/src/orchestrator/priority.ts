/**
 * WHICH CANDIDATE IS RAISED FIRST (R5, thread `016-protocol-roadmap`) — the rule that
 * replaces the ORDER OF THE SCAN.
 *
 * Until now "who goes next" was answered by `threadsWaitingOn`, that is by the
 * alphabet of the thread directories: with one live thread the answer was always
 * right, and with two it becomes right by accident. A tick raises AT MOST ONE pair,
 * so the order of the candidates is the whole scheduling policy of the circuit —
 * and a policy that nobody chose is the one that is hardest to argue with later.
 *
 * THREE TIERS, IN THIS ORDER, AND NOTHING ELSE (curator's boundary):
 *  1. the explicit priority of the thread — `high` before `normal` before `low`;
 *  2. the age of the wait — whoever has been waiting longest goes first;
 *  3. the thread number — a stable tiebreaker, so that an equal pair does not swap
 *     places between ticks and make the queue unreadable.
 *
 * No weights, no scores, no configurable strategies: the ordering is a total order
 * computable from data already in the feed, and its whole value is that a human can
 * predict it without reading code.
 *
 * WHY THE PRIORITY LIVES IN THE FEED and not in the config (the fork curator left to
 * this package). The same argument john settled R21 with, and it is stronger here: a
 * thread's importance is a property OF THE MOMENT, not of the thread — the same
 * conversation is a background chore on Monday and the thing everything waits on by
 * Thursday. A config field would be a standing declaration that has to be remembered
 * and un-remembered by hand, in a mutable file two writers edit; a header field is
 * append-only, its audit is free (who raised the thread and when IS the message), and
 * it expires the way statements expire — by a later one. The cost is that priority
 * cannot be set for a thread that has no message yet, and that cost is empty: a thread
 * with no messages has nobody waiting on it and is not a candidate.
 *
 * THE AGE OF THE WAIT IS COUNTED FROM THE HANDOFF, not from the first unanswered
 * message: from the message that put THIS role into `waiting-on` and has not been
 * lifted since. Counting from the first unanswered message would punish a thread for
 * being talkative — a conversation where three roles spoke while one was awaited
 * would look older than one where the same handoff happened yesterday in silence.
 */
import type { Message, ThreadPriorityValue } from "../thread/message.js";
import type { Candidate } from "./tick.js";

/**
 * The vocabulary lives with the PARSER (`thread/message.ts`), not here: the field is
 * refused at the door and on read, and a second copy of the list is the way the two
 * halves drift. This module only orders what has already been parsed.
 */
export type ThreadPriority = ThreadPriorityValue;

/** What a thread's priority defaults to when nobody has said anything. */
export const DEFAULT_THREAD_PRIORITY: ThreadPriority = "normal";

/** A priority as it was found in the feed — with whoever said it and when. */
export type FeedPriority = {
  readonly priority: ThreadPriority;
  readonly from: string;
  readonly date: string;
};

export type PriorityVerdict = {
  /** The one in force, if any: the last one written by an authorized role. */
  readonly effective?: FeedPriority;
  /**
   * What was found and NOT applied, in the package's own words. Same discipline as
   * the launch directive (R21): an unauthorized priority is dropped OUT LOUD, because
   * a queue ordered by a directive nobody honoured looks exactly like a queue that
   * honoured it.
   */
  readonly ignored: readonly string[];
};

/**
 * The priority in force for a thread, plus everything ignored on the way.
 *
 * `authorized` is injected rather than taken as a registry — the same split the
 * launch directive uses: the one fact this needs from the config is a predicate, and
 * passing it keeps the module free of the loader.
 */
export const resolveThreadPriority = (input: {
  readonly messages: readonly Message[];
  readonly authorized: (role: string) => boolean;
}): PriorityVerdict => {
  let effective: FeedPriority | undefined;
  const ignored: string[] = [];
  for (const message of input.messages) {
    const priority = message.fields.priority;
    if (priority === undefined) continue;
    const found: FeedPriority = { priority, from: message.fields.from, date: message.fields.date };
    if (!input.authorized(found.from)) {
      ignored.push(
        `the priority '${found.priority}' of '${found.from}' (${found.date}) is NOT in force: the role does not hold 'thread-priority'`,
      );
      continue;
    }
    effective = found;
  }
  return { ...(effective === undefined ? {} : { effective }), ignored };
};

/**
 * WHEN THE TURN WAS PASSED TO THE ROLE — the date of the message that put it into
 * `waiting-on` and was never lifted since.
 *
 * A missing `waiting-on` means "I am not passing the turn" (the previous holder is
 * inherited), so the field is folded across the feed and only a TRANSITION into the
 * turn counts as a handoff. `undefined` means the role is not awaited at all — the
 * caller has no candidate to rank in the first place.
 */
export const waitingSince = (input: {
  readonly messages: readonly Message[];
  readonly role: string;
}): string | undefined => {
  let awaited = false;
  let since: string | undefined;
  for (const message of input.messages) {
    const next = message.fields.waitingOn;
    if (next === undefined) continue;
    const nowAwaited = next === input.role;
    if (nowAwaited && !awaited) since = message.fields.date;
    awaited = nowAwaited;
  }
  return awaited ? since : undefined;
};

/**
 * THE NUMBER OF A THREAD as the last tiebreaker. Thread ids are `NNN-slug` by the
 * protocol's own naming, so the number is the oldest-first key; an id that does not
 * start with digits sorts AFTER every numbered one (and among its own kind by id), so
 * a foreign naming scheme degrades to alphabetical instead of throwing.
 */
export const threadNumber = (id: string): number => {
  const match = /^(\d+)/.exec(id);
  return match === null ? Number.POSITIVE_INFINITY : Number(match[1]);
};

/** A candidate with everything the order is computed from — read once, compared many times. */
export type RankedCandidate = Candidate & {
  readonly priority: ThreadPriority;
  /** The handoff stamp; `undefined` sorts as "no known wait" — behind every dated one. */
  readonly since?: string;
};

const RANK: Record<ThreadPriority, number> = { high: 0, normal: 1, low: 2 };

/**
 * The queue, most deserving first. A TOTAL order: every comparison ends in the thread
 * number, and thread ids are unique among candidates of one role, so the sort is
 * deterministic without depending on the stability of the engine's sort.
 *
 * Dates are compared as STRINGS on purpose: both message stamp formats
 * (`2026-07-26T18:40:00Z` and the migrated `2026-07-26`) are lexicographically
 * ordered by time, and parsing them into `Date` would turn an unparseable stamp from
 * "sorts oddly" into "the daemon throws mid-tick".
 */
export const orderCandidates = (candidates: readonly RankedCandidate[]): RankedCandidate[] =>
  [...candidates].sort((a, b) => {
    const byPriority = RANK[a.priority] - RANK[b.priority];
    if (byPriority !== 0) return byPriority;
    // Oldest wait first. A candidate whose handoff cannot be dated is not given the
    // benefit of looking ancient: it goes behind the dated ones.
    if (a.since !== b.since) {
      if (a.since === undefined) return 1;
      if (b.since === undefined) return -1;
      return a.since < b.since ? -1 : 1;
    }
    const byNumber = threadNumber(a.thread) - threadNumber(b.thread);
    if (byNumber !== 0 && Number.isFinite(byNumber)) return byNumber;
    return a.thread < b.thread ? -1 : a.thread > b.thread ? 1 : 0;
  });

/**
 * THE QUEUE, BUILT ONCE FOR EVERYBODY (T-0, thread 019). The daemon composed this by
 * hand inside its loop; the operator frame needs the same thing, and a second copy of
 * "read the feed → resolve the priority → date the wait" is exactly where the queue a
 * human is shown starts to differ from the queue the circuit follows. Both callers
 * ask here now.
 *
 * `ignored` carries the priorities that were dropped for lack of the right — every
 * caller says them out loud (the daemon into its stream, the frame into its queue
 * panel): a queue ordered by a statement nobody honoured looks exactly like a queue
 * that honoured it.
 */
export const rankCandidates = (input: {
  readonly threads: readonly { readonly id: string; readonly messages: readonly Message[] }[];
  /** The roles THIS box would raise — the queue is scoped to them, as the tick is. */
  readonly roles: readonly string[];
  /** Which threads await a role — passed in, so this module stays free of the feed's shape. */
  readonly waitingOn: (role: string) => readonly string[];
  readonly authorized: (role: string) => boolean;
}): { readonly ranked: RankedCandidate[]; readonly ignored: string[] } => {
  const byId = new Map(input.threads.map((thread) => [thread.id, thread]));
  const ignored: string[] = [];
  const ranked = input.roles.flatMap((roleId) =>
    input.waitingOn(roleId).map((thread): RankedCandidate => {
      const messages = byId.get(thread)?.messages ?? [];
      const verdict = resolveThreadPriority({ messages, authorized: input.authorized });
      for (const line of verdict.ignored) ignored.push(`${thread} — ${line}`);
      const since = waitingSince({ messages, role: roleId });
      return {
        role: roleId,
        thread,
        priority: verdict.effective?.priority ?? DEFAULT_THREAD_PRIORITY,
        ...(since === undefined ? {} : { since }),
      };
    }),
  );
  return { ranked, ignored };
};

/**
 * The queue in words, for the daemon's stream. Printed BEFORE the tick decides, so
 * that "why this pair and not that one" is answerable from the log alone — the same
 * reason every skip says its reason out loud (curator's requirement 1 of the 2026-07-26
 * defect report).
 */
export const describeOrder = (ordered: readonly RankedCandidate[]): string[] =>
  ordered.map((candidate, at) => {
    const waited =
      candidate.since === undefined ? "no dated handoff" : `waiting since ${candidate.since}`;
    return `queue ${at + 1}/${ordered.length}: ${candidate.role}×${candidate.thread} — priority ${candidate.priority}, ${waited}`;
  });
