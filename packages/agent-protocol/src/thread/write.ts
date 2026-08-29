/**
 * Creating messages and threads — the write operations that MAKE a file write
 * into a non-migrated thread impossible by construction, rather than forbidden by
 * a rule.
 *
 * The risk this closes (thread 012, msg-034/053/056): when `messages/` is present,
 * `loadThread` reads the files and IGNORES the legacy `_thread.md`. So the first
 * file write into a not-yet-migrated thread would make the generator rebuild the
 * feed from a SINGLE file — that is, truncate the thread's history. While a thread
 * is in the legacy form, writing to it by file is not allowed, and that must be
 * guaranteed by the tool rather than by the author's discipline: a rule that holds
 * by discipline is not a rule (the general conclusion of the day).
 *
 * This module is the pure core (planning the files), "string → files". The actual
 * creation on disk and git live in the CLI above it.
 */
import type {
  LaunchDirective,
  MessageFields,
  TaskDeclaration,
  ThreadPriorityValue,
  VerdictValue,
} from "./message.js";
import { messageFileName, renderMessageFile, VERDICT_VALUES } from "./message.js";
import { renderMetaFile, type ThreadMeta, type ThreadTurn } from "./thread.js";

export type PlannedFile = {
  readonly path: string;
  readonly content: string;
};

export class WriteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteRefusedError";
  }
}

/** A message's UTC stamp from a point in time: `2026-07-24T10:30:00Z` (no milliseconds). */
export const messageTimestamp = (at: Date): string => `${at.toISOString().slice(0, 19)}Z`;

/**
 * The stamp of a NEW message, MONOTONIC along the feed. A message is appended
 * AFTER the ones already there — so its stamp must be strictly greater than the
 * last of them, otherwise writer clock skew reorders the feed. A real case
 * (thread 012): a reply got the stamp `22:45` while curator's question it answers
 * had `22:47` (curator's clock runs ahead of mine), so the answer landed BEFORE
 * the question and INDEX showed the turn with the wrong role. The same class as
 * `seq` for migrated messages: order must not depend on clocks agreeing.
 *
 * `existing` — stamps of the NEW messages already there (migrated ones, dated
 * without a time, are NOT included: by the comparator they always precede new
 * ones, and their "date" may even be in the future relative to UTC). We return
 * `max(now, last + 1s)` — which along the way also resolves a name collision when
 * two writes happen within one second.
 */
export const nextMessageTimestamp = (now: Date, existing: readonly string[]): string => {
  const nowIso = messageTimestamp(now);
  const latest = existing.reduce((max, ts) => (ts > max ? ts : max), "");
  if (latest === "" || nowIso > latest) return nowIso;
  return messageTimestamp(new Date(new Date(latest).getTime() + 1000));
};

export type NewMessageInput = {
  readonly from: string;
  /** What is writing this (R7). Resolved by the CLI: the flag, or the launch channel. */
  readonly worker?: string;
  /** The id of the run writing it, where the run can name itself. */
  readonly session?: string;
  readonly date: string;
  readonly expects: MessageFields["expects"];
  readonly waitingOn?: string | null;
  /** With what the runs of this thread are to be raised from here on (R21). */
  readonly launch?: LaunchDirective;
  /** Which waiting thread is raised first from here on (R5). */
  readonly priority?: ThreadPriorityValue;
  /** Whose decision the turn is frozen behind — a person, and only a person (R27). */
  readonly parkedOn?: string;
  /** Whose word this message carries — the one lift of a park on that person (thread 030). */
  readonly delivers?: string;
  /** The PR this message announces as merged — it lifts the parks that wait on it (thread 023). */
  readonly mergedPr?: number;
  /**
   * The verdict of a review round and the PR it is about (thread 042) — declared and refused as
   * ONE field, see the refusal in `planNewMessage`.
   */
  readonly verdict?: VerdictValue;
  readonly pr?: number;
  /** Tasks this message declares or moves (thread 021) — the source the board derives from. */
  readonly tasks?: readonly TaskDeclaration[];
  readonly text: string;
  /** true — the thread has `messages/` (migrated / file-based). false — legacy. */
  readonly threadHasMessages: boolean;
};

/**
 * The file of a new message for an existing file-based thread.
 *
 * A REFUSAL rather than a creation if the thread is still in the legacy form:
 * `threadHasMessages=false` catches exactly the case the whole guard exists for.
 */
export const planNewMessage = (input: NewMessageInput): PlannedFile => {
  if (!input.threadHasMessages) {
    throw new WriteRefusedError(
      "the thread is still in the legacy form (no messages/): a file write would truncate its history. Migrate the thread first.",
    );
  }
  if (input.text.trim() === "") {
    throw new WriteRefusedError("the message body is empty");
  }
  // THE VERDICT IS DECLARED BY A PAIR (thread 042, `PROTOCOL.md` of 2026-08-29) — and the refusal
  // stands HERE rather than only at the CLI flags, because both writing commands of the pair come
  // through this one function and a rule held by one of them is the lesson of 075 all over again.
  // A verdict without an address is a remark, an address without a verdict says nothing happened;
  // the reader drops both halves, so a message written with one would be silently ignored.
  if ((input.verdict === undefined) !== (input.pr === undefined)) {
    throw new WriteRefusedError(
      input.verdict === undefined
        ? `'pr: ${input.pr}' is declared without a verdict: a review verdict is a PAIR of fields. Add the outcome ('--verdict ${VERDICT_VALUES.join("' or '--verdict ")}'), or drop '--pr' — the number of a PR alone opens no turn and is read by nobody`
        : `'verdict: ${input.verdict}' is declared without the PR it is about: a review verdict is a PAIR of fields. Add the address ('--pr <number>'), or drop '--verdict' — a verdict with no address is a remark rather than an outcome, and the reader of the feed drops both halves`,
    );
  }

  const fields: MessageFields = {
    from: input.from,
    ...(input.worker === undefined ? {} : { worker: input.worker }),
    ...(input.session === undefined ? {} : { session: input.session }),
    date: input.date,
    expects: input.expects,
    ...(input.waitingOn === undefined ? {} : { waitingOn: input.waitingOn }),
    ...(input.launch === undefined ? {} : { launch: input.launch }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.parkedOn === undefined ? {} : { parkedOn: input.parkedOn }),
    ...(input.delivers === undefined ? {} : { delivers: input.delivers }),
    ...(input.mergedPr === undefined ? {} : { mergedPr: input.mergedPr }),
    ...(input.verdict === undefined ? {} : { verdict: input.verdict }),
    ...(input.pr === undefined ? {} : { pr: input.pr }),
    ...(input.tasks === undefined ? {} : { tasks: input.tasks }),
  };
  return {
    path: `messages/${messageFileName(fields)}`,
    content: renderMessageFile({ fields, text: input.text }),
  };
};

/**
 * THE NUMBER OF A THREAD IS ITS SHORT ADDRESS — and an address that names two things
 * is not an address (curator, thread 029). `029` was handed out twice in one day
 * (`029-circuit-metrics` and `029-reviewer-verdict-absence`), and from then on "тред
 * 029" in a feed needed a slug beside it to mean anything.
 *
 * Nothing is renamed after the fact: the FULL id stays unique, so every link ever
 * written still resolves. The door is what changes — reading the directory names of
 * the mail is cheap, and a number already in use is refused at creation instead of
 * being discovered by a reader a week later.
 *
 * The comparison is NUMERIC, not textual: `29` and `029` are the same address said
 * two ways, and a guard that let the second one through would be a guard against
 * typing, not against collision.
 */
export const threadNumber = (id: string): number | undefined => {
  const digits = /^(\d+)-/.exec(id)?.[1];
  return digits === undefined ? undefined : Number(digits);
};

/** The existing thread whose number `id` would take, if any. */
export const threadNumberTaker = (id: string, existing: readonly string[]): string | undefined => {
  const number = threadNumber(id);
  if (number === undefined) return undefined;
  return existing.find((other) => other !== id && threadNumber(other) === number);
};

export type NewThreadInput = {
  readonly title: string;
  readonly participants: readonly string[];
  readonly from: string;
  readonly worker?: string;
  readonly session?: string;
  readonly date: string;
  readonly expects: MessageFields["expects"];
  readonly waitingOn?: string | null;
  /** Whose decision the turn is frozen behind (R27) — the same field the first message may carry. */
  readonly parkedOn?: string;
  /**
   * Whose word the first message carries (thread 030) — passed through for the same reason
   * `parked-on` is: the first message is a message, and a thread can be opened by the courier
   * of a decision just as it can be opened by a question to its owner (075, 074).
   */
  readonly delivers?: string;
  /**
   * The verdict of a review round and its PR (thread 042) — passed through for the reason
   * `delivers` and `parked-on` are: the first message is a message, and a rule held by one
   * command of the pair is the lesson of 075. The pair is judged in `planNewMessage`, once.
   */
  readonly verdict?: VerdictValue;
  readonly pr?: number;
  /** The form declared for the answers of this thread (079) — see `ThreadTurn`. */
  readonly turn?: ThreadTurn;
  readonly text: string;
};

/**
 * The files of a new thread STRAIGHT in the file form: `_meta.md` + the first
 * message in `messages/`. Legacy threads are no longer born — so `new-message`
 * will never hit one, and the invariant holds by construction.
 *
 * THE FIRST MESSAGE IS A MESSAGE (thread 075): the header fields it may carry are the
 * fields any message carries, and `parked-on` is passed through for that reason and
 * not as a special case. It was the one field an opening message could not say until
 * 2026-08-14 — 074 was opened `--parked-on john` and written without it — and the cost
 * of the silence is not a refusal but an empty raise a tick later.
 */
export const planNewThread = (input: NewThreadInput): PlannedFile[] => {
  if (input.text.trim() === "") throw new WriteRefusedError("the first message body is empty");

  const meta: ThreadMeta = {
    title: input.title,
    participants: input.participants,
    status: "open",
    ...(input.turn === undefined ? {} : { turn: input.turn }),
  };
  const first = planNewMessage({
    from: input.from,
    ...(input.worker === undefined ? {} : { worker: input.worker }),
    ...(input.session === undefined ? {} : { session: input.session }),
    date: input.date,
    expects: input.expects,
    ...(input.waitingOn === undefined ? {} : { waitingOn: input.waitingOn }),
    ...(input.parkedOn === undefined ? {} : { parkedOn: input.parkedOn }),
    ...(input.delivers === undefined ? {} : { delivers: input.delivers }),
    ...(input.verdict === undefined ? {} : { verdict: input.verdict }),
    ...(input.pr === undefined ? {} : { pr: input.pr }),
    text: input.text,
    threadHasMessages: true, // a new thread is file-based by construction
  });

  return [{ path: "_meta.md", content: renderMetaFile(meta) }, first];
};
