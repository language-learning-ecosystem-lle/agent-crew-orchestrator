/**
 * "READ THE LAST MESSAGE" IS NOT READING A THREAD WHEN TWO ROLES WRITE AT ONCE
 * (thread `058-concurrent-writers-one-thread`, john's word of 2026-08-30 ~15:39Z:
 * «получается, что пишется одновременно несколько сообщений, а ты потом придёшь и
 * прочитаешь только последнее»).
 *
 * THE MEASURED CASE, a consumer's circuit, 2026-08-30. A merge returned the
 * turn to its author at `14:23:55Z`; dev-acme was raised at `14:24:19Z`; curator, in her
 * own live session, wrote a question to john and parked the thread at `14:24:50Z` — thirty
 * one seconds after that raise; dev-acme finished its own letter at `14:26:53Z`, into a
 * thread that had been frozen while it was writing. Nobody broke a rule: the scheduler
 * plans PAIRS (role × thread) and the `waiting-on` of the last letter forbids the second
 * pair nothing. What broke is the READING — three readers in a row took the last line for
 * the state of the conversation, and the question the thread was frozen on was in the line
 * before it.
 *
 * SO THE COUNT IS A PROPERTY OF THE READING TOOL, NOT OF THE ROLE'S MEMORY (curator's
 * statement, B.1). A raised session cannot be asked to remember what it has already read:
 * it is a fresh process with no memory of the previous one, and "read from your own last
 * letter down" is a fact the FEED can answer and the session cannot. `thread show --for
 * <role>` answers it in one line above the conversation, and — this is the half that makes
 * it a door rather than a decoration — `--tail` may never cut into that run: a bounded read
 * that hides an unread message is exactly the failure this file exists against.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not remember. There is no cursor file, no "read
 * marks", nothing to get out of sync with the feed — the last letter OF THAT ROLE is the
 * mark, it is already in the mail, and it is the same mark on every box that reads the same
 * branch. A role that has never written here has read nothing here, and the line says so.
 */

import type { Message } from "./message.js";

/** What a role has not seen since it last wrote into a thread — the whole of the answer. */
export type UnreadForRole = {
  /** Whose reading this is — the role named by `--for`, carried so the line can say it. */
  readonly role: string;
  /** Messages in the thread, all of them: the denominator of "K of N". */
  readonly total: number;
  /**
   * How many messages arrived AFTER that role's own last letter. The whole thread when the
   * role has never written into it — it has read nothing here, and pretending otherwise is
   * the one direction of error that loses a message.
   */
  readonly unread: number;
  /** The stamp of the role's own last letter; absent — it has never written in this thread. */
  readonly since?: string | undefined;
  /**
   * WHO WROTE THE UNREAD RUN, in order of first appearance and without repeats — the fact
   * that makes concurrency VISIBLE in one line. Two names here is the shape of the incident
   * above: the letter that passed the turn, and somebody else's letter beside it.
   */
  readonly authors: readonly string[];
};

/**
 * The reading itself: the LAST message whose `from` is this role is the mark, everything
 * after it is unread.
 *
 * The mark is the last one and not the first for the case that produced this file: a role
 * raised twice on the same thread has written twice, and only the newer letter says what it
 * had already seen.
 */
export const unreadFor = (messages: readonly Message[], role: string): UnreadForRole => {
  let mark = -1;
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    if (messages[at]?.fields.from === role) {
      mark = at;
      break;
    }
  }
  const after = messages.slice(mark + 1);
  const authors: string[] = [];
  for (const message of after) {
    const { from } = message.fields;
    if (!authors.includes(from)) authors.push(from);
  }
  const since = mark === -1 ? undefined : messages[mark]?.fields.date;
  return {
    role,
    total: messages.length,
    unread: after.length,
    authors,
    ...(since === undefined ? {} : { since }),
  };
};

/**
 * THE LINE THE READER SEES, and it says the three facts a reader of a thread with two live
 * writers needs: how many messages are new TO THEM, where the run starts, and who wrote it.
 *
 * The count is said even when it is zero and even when it is the whole thread. A number
 * printed only when it is "interesting" teaches the reader that its absence means nothing in
 * particular, and the absence is then indistinguishable from a reader that never asked —
 * which is the state every session was in until this flag existed.
 */
export const describeUnread = (facts: UnreadForRole): string => {
  const who = facts.authors.length === 0 ? "" : ` — written by ${facts.authors.join(", ")}`;
  if (facts.since === undefined) {
    return `unread for ${facts.role}: all ${facts.total} message(s) — ${facts.role} has not written in this thread yet${who}`;
  }
  if (facts.unread === 0) {
    return `unread for ${facts.role}: none — the last message in the thread is ${facts.role}'s own letter of ${facts.since}`;
  }
  return `unread for ${facts.role}: ${facts.unread} of ${facts.total} message(s), everything after ${facts.role}'s own letter of ${facts.since}${who}`;
};

/**
 * WHAT THE WRITER IS TOLD WHEN LETTERS LANDED UNDER ITS OWN LAST ONE (thread 091, john's
 * word of 2026-09-03 ~12:55Z: «чинить нотой»).
 *
 * THE MEASURED CASE, this contour's own tick, 2026-09-03: `09:29:30Z` curator reads thread
 * `056` at the start of her tick → `09:31:42Z` dev-core lays a letter about a cut tag into it
 * → `09:36Z` curator sends a letter saying «письма о теге в треде нет». A statement ABOUT the
 * feed, written INTO the feed, false for two minutes by the time it was sent. Nothing raced:
 * seven minutes of run-up, one push each, so the delivery note `(after N attempts: the feed
 * moved underneath)` said nothing BY CONSTRUCTION — it stands behind `attempts > 1` and only
 * ever catches a lost push. The rule "re-read the feed before you write" was already in the
 * texts and did not hold: an appeal does not hold, a precondition at the action does.
 *
 * A NOTE AND NOT A REFUSAL, and that half is the decision rather than an omission: writing
 * without reading is legitimate (a report into somebody else's thread, a letter from a
 * machine), and a door that stops the writing is worse than one that stays quiet.
 *
 * IT SPEAKS ONLY WHEN IT HAS SOMETHING TO SAY, and says it with a number and an address — how
 * many letters, from which roles, the stamp of the last — so the reader can decide whether to
 * re-read WITHOUT opening the feed. Two silences are deliberate:
 *
 *   - nothing landed under the sender's letter → no line at all. A count printed as "0" on
 *     every send is the noise that teaches the reader to skip the line that matters;
 *   - THE SENDER HAS NEVER WRITTEN HERE → no line either. There is no letter of theirs for
 *     anything to have landed "under", and a first letter into somebody else's thread is
 *     exactly the legitimate "writing without reading" the refusal was rejected for. What such
 *     a writer needs is `thread show --for <role>`, which says "all N message(s)" and is the
 *     read they are about to do anyway.
 */
export const noteFeedUnderSender = (input: {
  readonly messages: readonly Message[];
  /** The role in `--from` — whose own last letter is the mark. */
  readonly sender: string;
  /** Carried only so the line can hand back the exact command to re-read with. */
  readonly thread: string;
}): string | undefined => {
  const facts = unreadFor(input.messages, input.sender);
  if (facts.since === undefined || facts.unread === 0) return undefined;
  // The run is the TAIL of the feed by construction of `unreadFor`, so the last message of the
  // thread is the last message of the run — no second scan to find its stamp.
  const last = input.messages.at(-1)?.fields.date ?? facts.since;
  return `${facts.unread} message(s) landed under your own letter of ${facts.since} before this one — written by ${facts.authors.join(", ")}, the last of them ${last}. If what you have just sent says anything about the state of this thread, re-read it: 'thread show --thread ${input.thread} --for ${input.sender}'`;
};

/**
 * HOW MANY MESSAGES A BOUNDED READ MUST SHOW so that it hides no unread one (B.1, the half
 * that makes this a door).
 *
 * `--tail 1` on a thread with two fresh letters is the incident itself, mechanised: it shows
 * the last one, prints "1 earlier message is NOT shown", and the reader that trusted the
 * bound has just been handed the exact reading john refused. So the bound is WIDENED to the
 * unread run and the widening is announced — the alternative, refusing the combination, would
 * cost the reader the one flag that makes a 300 KB thread readable at all.
 *
 * It never SHRINKS a tail: a reader who asked for 50 messages on a thread with 2 unread ones
 * asked for context around them, and that is a legitimate reading.
 */
export const tailCovering = (tail: number, facts: UnreadForRole): number =>
  Math.max(tail, facts.unread);
