/**
 * A STANDING ADDRESS IS NOT AN ETERNAL THREAD — IT IS A ROLE ORDINARY THREADS TAKE IN TURN
 * (decision of john 2026-09-03, thread 080, `msg-002`).
 *
 * Two workflows of the mail carry thread ids as LITERALS: `ci-outcome.yml` writes the redness
 * of `main` into `076-main-red-alarm`, `notifier-watch.yml` writes the failure of the notifier
 * into `077-notifier-down`. The catalogue of those addresses was held by one line of prose in
 * the first letter of each — "this thread is not closed and not parked" — and a session working
 * on a NEIGHBOURING thread neither reads that line nor has to.
 *
 * WHAT THE FAILURE ACTUALLY IS, measured before this was written (thread 080, `msg-003`, four
 * dry runs against the real mail): the letter is NOT lost. Both workflows write `--from github`,
 * `github` is a machine writer in the config, and after the decision of thread 072 a machine
 * event is not asked what it does about a park — it goes through, with a note. A CLOSED thread
 * is not even checked. So the letter lands, the run is green, and:
 *
 * - `waitingOnOf` returns `undefined` for a closed thread before it reads any declaration at
 *   all ("a closed thread awaits nobody");
 * - a parked thread "raises nobody" by the same rule, one level down.
 *
 * That is, the alarm is DELIVERED AND RAISES NO ONE, and there is no redness anywhere to say
 * so. A door cannot defend against that — there is nothing to refuse, the letter is lawful —
 * so what defends against it is CHOOSING A LIVE RECEIVER, which is this module.
 *
 * THE SHAPE OF THE ADDRESS COSTS NOTHING (measured, `msg-003` §4): a thread id is unique BY ITS
 * NUMBER only — `threadNumberTaker` compares `NNN` and never looks at the slug. So the receivers
 * of one address are `076-main-red-alarm`, `091-main-red-alarm`, `104-main-red-alarm`: the same
 * slug, the next free number. No new form of address, no date suffix, no new field.
 *
 * FIT = OPEN AND NOT PARKED, both conditions for ONE reason (it raises a turn) and not for two.
 * Everything else — closed, parked, unreadable — is not a defect to be fixed here: the receiver
 * did its job and ended, and the next event opens the next one.
 */
import { threadNumber } from "./write.js";

/** The greatest number a thread id can carry: the reader takes `^\d{3}-` and nothing wider. */
export const MAX_THREAD_NUMBER = 999;

/** The form of a slug that may stand as the tail of a thread id. */
const RECEIVER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A thread of the mail as the choice sees it: its id, and whether a letter into it would
 * raise anybody. Nothing else about a thread is relevant here, and reading the feed is the
 * caller's job — this stays a judgement over data (and therefore testable without a disk).
 */
export type ReceiverThread = {
  readonly id: string;
  readonly status: "open" | "closed";
  /** Whether a park stands on it now — `parkingOf` of the caller, folded to a yes/no. */
  readonly parked: boolean;
  /**
   * `false` when the thread is there but its feed could not be parsed. It is NOT a candidate
   * (nobody may write into a conversation nobody can read) and its NUMBER is taken all the
   * same — the directory exists, and handing that number out again would collide on disk.
   */
  readonly readable?: boolean;
};

/** Why no existing thread of this slug could take the letter. */
export type ReceiverBlocked = {
  readonly id: string;
  readonly why: "closed" | "parked" | "unreadable";
};

export type ReceiverChoice =
  | { readonly kind: "existing"; readonly id: string }
  | {
      readonly kind: "create";
      readonly id: string;
      /** The receivers of this slug that could not take it, newest first. Empty — there were none. */
      readonly blocked: readonly ReceiverBlocked[];
    };

export class ReceiverRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiverRefusedError";
  }
}

/** The tail of a thread id: `076-main-red-alarm` → `main-red-alarm`. */
export const threadSlug = (id: string): string | undefined => {
  const match = /^\d{3}-(.+)$/.exec(id);
  return match?.[1];
};

/**
 * THE REFUSAL ON THE SLUG ITSELF, by name and before anything is read or written — the door
 * `refuseUnreadableThreadId` is for a whole id, said for the half a caller of `--ensure-thread`
 * hands in. The three cases it catches are the three that would each fail LATER and quieter:
 * a slug that is not a plain directory name (a path separator, `..`), a slug that already
 * carries a number (the workflows hold FULL ids today, so `--ensure-thread 076-main-red-alarm`
 * is the first typo anyone will make, and it would open `091-076-main-red-alarm`), and one that
 * would make an id the mail's walker never visits.
 */
export const unreadableReceiverSlug = (slug: string): string | undefined => {
  if (/^\d{3}-/.test(slug)) {
    return `--ensure-thread '${slug}' is a whole thread id, not a slug: the number is what this flag hands out, so it must not be given one. A receiver of this address would be opened as '<next free NNN>-${slug}', i.e. a number in front of a number. Pass the tail alone — '${threadSlug(slug)}'`;
  }
  if (!RECEIVER_SLUG.test(slug)) {
    return `--ensure-thread '${slug}' is not a slug a thread id can carry: the required form is ${RECEIVER_SLUG.source} — lowercase letters, digits and single dashes, e.g. 'main-red-alarm'. The slug becomes the tail of a directory name in the mail ('<NNN>-${slug}'), so a separator, a dot or a space in it would open a thread under a path the walker of the conversations directory never visits: everything sent there would reach nobody, and nobody would be told`;
  }
  return undefined;
};

/**
 * WHICH THREAD THIS EVENT GOES INTO — the existing receiver of the slug if one can raise a
 * turn, otherwise the id of the one to open.
 *
 * `threads` is the WHOLE mail, not the threads of this slug: the number handed out on creation
 * has to be free against every thread there is (`threadNumberTaker` refuses a taken number, and
 * for the reason of thread 029 — a number is a short address, and an address that names two
 * things is not an address).
 *
 * THE NEXT NUMBER IS THE ONE AFTER THE LAST, not the first hole in the sequence. A gap in the
 * numbering is a thread that was never opened, and filling it would put today's receiver in the
 * middle of last month's conversations: the number of a thread is read as its order, in every
 * link that ever says "тред 076".
 *
 * Several receivers fit → the NEWEST by number. There should be one, but two open receivers of
 * one slug is a state the mail can reach by hand, and "the newest" is the only answer that does
 * not scatter one address's events across two conversations.
 */
export const chooseReceiver = (input: {
  readonly slug: string;
  readonly threads: readonly ReceiverThread[];
}): ReceiverChoice => {
  const problem = unreadableReceiverSlug(input.slug);
  if (problem !== undefined) throw new ReceiverRefusedError(problem);

  const mine = input.threads
    .filter((thread) => threadSlug(thread.id) === input.slug)
    .sort((a, b) => (threadNumber(b.id) ?? 0) - (threadNumber(a.id) ?? 0));

  const fit = mine.find(
    (thread) => thread.readable !== false && thread.status === "open" && !thread.parked,
  );
  if (fit !== undefined) return { kind: "existing", id: fit.id };

  const blocked = mine.map(
    (thread): ReceiverBlocked => ({
      id: thread.id,
      why:
        thread.readable === false ? "unreadable" : thread.status === "closed" ? "closed" : "parked",
    }),
  );

  const highest = input.threads.reduce((max, thread) => {
    const number = threadNumber(thread.id);
    return number !== undefined && number > max ? number : max;
  }, 0);
  const next = highest + 1;
  if (next > MAX_THREAD_NUMBER) {
    throw new ReceiverRefusedError(
      `the mail has reached thread ${highest}, and a receiver for '${input.slug}' would be number ${next} — a thread id carries three digits and no more (the walker takes only '^\\d{3}-'), so there is no free address left to open one under. Nothing was written. A fourth digit is a new form of address, which is a change of the norm and not of this command`,
    );
  }
  return { kind: "create", id: `${String(next).padStart(3, "0")}-${input.slug}`, blocked };
};

/** What the caller says out loud about a receiver it had to open — the door must not be silent. */
export const receiverNote = (choice: Extract<ReceiverChoice, { kind: "create" }>): string =>
  choice.blocked.length === 0
    ? `no thread of this address exists yet — opening '${choice.id}' as its receiver`
    : `the receiver '${choice.blocked[0]?.id}' is ${choice.blocked[0]?.why} and raises nobody — opening '${choice.id}' as the next one for this address`;
