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
import type { LaunchDirective, MessageFields, ThreadPriorityValue } from "./message.js";
import { messageFileName, renderMessageFile } from "./message.js";
import { renderMetaFile, type ThreadMeta } from "./thread.js";

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
  readonly waitingOn?: readonly string[];
  /** With what the runs of this thread are to be raised from here on (R21). */
  readonly launch?: LaunchDirective;
  /** Which waiting thread is raised first from here on (R5). */
  readonly priority?: ThreadPriorityValue;
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

  const fields: MessageFields = {
    from: input.from,
    ...(input.worker === undefined ? {} : { worker: input.worker }),
    ...(input.session === undefined ? {} : { session: input.session }),
    date: input.date,
    expects: input.expects,
    ...(input.waitingOn === undefined ? {} : { waitingOn: input.waitingOn }),
    ...(input.launch === undefined ? {} : { launch: input.launch }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
  };
  return {
    path: `messages/${messageFileName(fields)}`,
    content: renderMessageFile({ fields, text: input.text }),
  };
};

export type NewThreadInput = {
  readonly title: string;
  readonly participants: readonly string[];
  readonly from: string;
  readonly worker?: string;
  readonly session?: string;
  readonly date: string;
  readonly expects: MessageFields["expects"];
  readonly waitingOn?: readonly string[];
  readonly text: string;
};

/**
 * The files of a new thread STRAIGHT in the file form: `_meta.md` + the first
 * message in `messages/`. Legacy threads are no longer born — so `new-message`
 * will never hit one, and the invariant holds by construction.
 */
export const planNewThread = (input: NewThreadInput): PlannedFile[] => {
  if (input.text.trim() === "") throw new WriteRefusedError("the first message body is empty");

  const meta: ThreadMeta = {
    title: input.title,
    participants: input.participants,
    status: "open",
  };
  const first = planNewMessage({
    from: input.from,
    ...(input.worker === undefined ? {} : { worker: input.worker }),
    ...(input.session === undefined ? {} : { session: input.session }),
    date: input.date,
    expects: input.expects,
    ...(input.waitingOn === undefined ? {} : { waitingOn: input.waitingOn }),
    text: input.text,
    threadHasMessages: true, // a new thread is file-based by construction
  });

  return [{ path: "_meta.md", content: renderMetaFile(meta) }, first];
};
