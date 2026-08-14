/**
 * Reading the conversations directory from disk. The only layer that knows about
 * `fs`: everything above is "string → string" functions and is therefore tested
 * without a file system.
 *
 * TWO FORMS LIVE SIDE BY SIDE and are told apart by the presence of `_meta.md`:
 * a migrated thread — read `_meta.md` plus whatever is in `messages/`; a
 * non-migrated one — parse the legacy `_thread.md`. Only this way do threads
 * migrate one at a time, without a "switch-over day" and without downtime of the
 * circuit. The sign used to be `messages/`, and it mistook a thread OPENED AND NOT
 * YET SPOKEN IN for a legacy one — see `loadThread`.
 *
 * A FAILURE OF ONE THREAD DOES NOT BLIND THE CIRCUIT (curator's statement of
 * work, thread 012, 21:35). Previously `loadThreads` parsed threads in a row and
 * the very first exception took down the WHOLE call — that is, `mail`, the watch
 * and the daemon tick for every role at once. And so it happened: a single
 * message file that landed in the legacy thread 009 without a `_meta.md` killed
 * mail for the entire circuit. In unattended mode this would have looked like
 * "nothing arrived overnight".
 *
 * The requirement is ISOLATION, not form validation: a broken thread is flagged,
 * its waiting is left out of the count, the reason is named loudly (thread id +
 * what exactly is wrong), the rest are read as usual. That is why `loadThreads`
 * returns not an array but a PAIR of "parsed + broken": the type forces every
 * caller to decide what it does with the broken ones instead of skipping silently.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { MessageEntry, ThreadInput } from "../thread/check.js";
import { compareMessageEntries, parseMessageFile } from "../thread/message.js";
import { parseLegacyThread, parseMetaFile, type Thread } from "../thread/thread.js";

const THREAD_DIR = /^\d{3}-/;

export type LoadedThread = {
  readonly thread: Thread;
  readonly input?: ThreadInput;
  /** true — the thread has not moved to message files yet. */
  readonly legacy: boolean;
};

/** A thread that could not be read: id + WHAT EXACTLY is wrong, for a human. */
export type ThreadFailure = {
  readonly id: string;
  readonly problem: string;
};

/**
 * A field of ONE message this reader could not make sense of (thread 023) — the thread was
 * read anyway. Carried beside the failures rather than folded into them because the two say
 * opposite things to the caller: a failure means "this conversation is not in your answer", a
 * warning means "it is, minus one field nobody plans with". Silence was never an option: a
 * dropped field with no line about it is the same silent staleness a refusal was chosen to avoid.
 */
export type ThreadWarning = {
  readonly id: string;
  /** The message file the field is in — the one thing that turns a warning into an action. */
  readonly file: string;
  readonly problem: string;
};

/**
 * A value of ONE message read in an off-canon SPELLING (thread 065, (iv)) — nothing was
 * dropped and nothing is missing from the answer. The third channel beside failures and
 * warnings because it is a third statement: "not in your answer", "in it minus a field",
 * "in it whole, but the file on disk is written another way". Folding it into the warnings
 * would say the field was dropped, which is not true of any of these.
 */
export type ThreadNotice = ThreadWarning;

/** Result of walking the directory: parsed threads and broken ones, separately. */
export type LoadedThreads = {
  readonly threads: readonly LoadedThread[];
  readonly failures: readonly ThreadFailure[];
  /** Fields dropped inside threads that WERE read — see `ThreadWarning`. */
  readonly warnings: readonly ThreadWarning[];
  /** Off-canon spellings read as their canon — see `ThreadNotice`. */
  readonly notices: readonly ThreadNotice[];
};

export const loadThread = (
  dir: string,
  id: string,
  knownRoles: readonly string[],
): LoadedThread => {
  const messagesDir = join(dir, "messages");
  const threadDocPath = join(dir, "_thread.md");
  const metaPath = join(dir, "_meta.md");
  const hasMessages = existsSync(messagesDir);
  const hasMeta = existsSync(metaPath);

  // WHICH FORM THIS IS, is answered by `_meta.md` and not by `messages/` (thread 042).
  // The two signs agree on every thread that has been spoken in, and they disagree on
  // exactly one state — A THREAD OPENED AND NOT YET SPOKEN IN, which is `_meta.md`
  // alone. `messages/` as the discriminator read that as legacy, went for the
  // `_thread.md` that a fresh thread does not have yet, and died on a raw ENOENT.
  // It is not a hypothetical state: `new-thread --write` puts both files in one commit,
  // but a human opening a conversation by hand pushes `_meta.md` first (john, 2026-08-05
  // — thread 055), and that push made `derive` red and rang the notifier at 042 for a
  // conversation that was in no way broken.
  if (!hasMeta) {
    // MESSAGES WITHOUT A HEAD ARE TWO STATES, NOT ONE, and each is called by the state it
    // is actually in (thread 042, 2026-08-14). Beside a legacy `_thread.md` it is a
    // HALF-MIGRATED thread: a message file dropped into a legacy thread by hand (bypassing
    // `new-message`, which refuses to make such a write). With no `_thread.md` at all
    // nothing was ever migrated — a conversation was OPENED without its head, which is what
    // a writer going around the door does, and calling that "half-migrated" sends the reader
    // looking for a migration that never happened.
    //
    // BOTH LINES NAME THE CURE, because the cure is a command of this package and neither
    // line used to mention it: `thread status --repair` synthesises the missing head out of
    // the messages (see `thread/repair.ts`), and a red `derive` job shows whoever is on duty
    // this line and nothing else. It is the recurring case, not a hypothetical one — 066 on
    // 2026-08-13 stood headless an afternoon, 077 on 2026-08-14 reddened every push to the
    // mail branch for eight minutes, and both were cured by a hand that had to know the
    // command already. A raw ENOENT on a file path would be a third way to say none of this.
    if (hasMessages) {
      const cure =
        " — 'thread status --thread <id> --from <role> --repair --write' synthesises a head from the messages";
      throw new Error(
        existsSync(threadDocPath)
          ? `half-migrated thread: 'messages/' is present but '_meta.md' is missing (a legacy '_thread.md' lies next to it — either finish migrating the thread or put the message back into it)${cure}`
          : `a thread opened without its head: 'messages/' is present but '_meta.md' is missing, and there is no legacy '_thread.md' either — nothing was migrated here, the head was never written${cure}`,
      );
    }
    if (!existsSync(threadDocPath)) {
      throw new Error(
        `neither '_meta.md' nor '_thread.md' — this directory is a thread in no form (an opened thread carries '_meta.md', a legacy one '_thread.md')`,
      );
    }
    const raw = readFileSync(threadDocPath, "utf8");
    return { thread: parseLegacyThread(id, raw, knownRoles), legacy: true };
  }

  const meta = parseMetaFile(readFileSync(metaPath, "utf8"));
  // Order comes from `seq` (`compareMessageEntries`), NOT from the file name: the
  // name leads with a date, and the date is sometimes non-monotonic against the
  // feed (msg-069 in 012). We read first and sort with the comparator afterwards —
  // a flat `.sort()` of names would lie.
  const entries: MessageEntry[] = (hasMessages ? readdirSync(messagesDir) : [])
    .filter((name) => name.endsWith(".md"))
    .map((fileName) => {
      try {
        return {
          fileName,
          message: parseMessageFile(readFileSync(join(messagesDir, fileName), "utf8")),
        };
      } catch (error) {
        // THE THREAD STILL DIES AS A WHOLE, AND ON PURPOSE — but it says WHICH file
        // killed it. A hole in the feed cannot be tolerated per message: the broken
        // header is as likely as any to be the LAST one, and then every reader that
        // asks "whose turn is it" would answer from a stale message with no sign that
        // it is stale (measured, thread 016: on 2026-07-28 three threads went
        // unreadable at once — 024, 029, 034 — and in all three the offending file WAS
        // the last one; in 034 it was the only one). Silent staleness is the defect
        // this package exists to remove, so refusing the thread is the honest failure.
        // What was NOT honest is refusing it without a name: `loadThreads` reported
        // only the parser's sentence ("'worker: claude.ai' — ..."), and finding the
        // one file behind it among dozens was the reader's problem.
        throw new Error(`messages/${fileName}: ${(error as Error).message}`);
      }
    })
    .sort(compareMessageEntries);

  const input: ThreadInput = {
    id,
    meta,
    entries,
    ...(existsSync(threadDocPath) ? { threadDoc: readFileSync(threadDocPath, "utf8") } : {}),
  };

  return {
    thread: { id, meta, messages: entries.map((entry) => entry.message) },
    input,
    legacy: false,
  };
};

/**
 * Walking the conversations directory. An unreadable ROOT is still an exception
 * thrown outwards (that is not "part of the mail is broken", that is "there is no
 * mail at all"), while a failure of an individual thread is isolated: it goes to
 * `failures` with its own reason, the rest are read.
 */
export const loadThreads = (root: string, knownRoles: readonly string[]): LoadedThreads => {
  const threads: LoadedThread[] = [];
  const failures: ThreadFailure[] = [];
  const warnings: ThreadWarning[] = [];
  const notices: ThreadNotice[] = [];

  for (const name of readdirSync(root)
    .filter((entry) => THREAD_DIR.test(entry) && statSync(join(root, entry)).isDirectory())
    .sort()) {
    try {
      const loaded = loadThread(join(root, name), name, knownRoles);
      threads.push(loaded);
      warnings.push(...threadWarnings(name, loaded));
      notices.push(...threadNotices(name, loaded));
    } catch (error) {
      failures.push({ id: name, problem: (error as Error).message });
    }
  }

  return { threads, failures, warnings, notices };
};

/**
 * The dropped fields of one thread, addressed by file. The file name comes from the entries
 * (`input`) and not from the message: a legacy thread has no files, and its sections carry no
 * header to be wrong in the first place — so there is nothing to address there and nothing to say.
 */
const threadWarnings = (id: string, loaded: LoadedThread): ThreadWarning[] =>
  (loaded.input?.entries ?? []).flatMap((entry) =>
    (entry.message.warnings ?? []).map((problem) => ({
      id,
      file: `messages/${entry.fileName}`,
      problem,
    })),
  );

/** The off-canon spellings of one thread, addressed by file — same shape, same reason. */
const threadNotices = (id: string, loaded: LoadedThread): ThreadNotice[] =>
  (loaded.input?.entries ?? []).flatMap((entry) =>
    (entry.message.notices ?? []).map((problem) => ({
      id,
      file: `messages/${entry.fileName}`,
      problem,
    })),
  );

/** Broken threads, one readable line each — for the caller's stderr. */
export const renderThreadFailures = (failures: readonly ThreadFailure[]): string[] =>
  failures.map((failure) => `thread '${failure.id}' could not be read: ${failure.problem}`);

/**
 * The same lines UNDER A COUNT — for everyone who counts the input (065.4): `mail`, the operator
 * frame and the daemon tick. The per-thread line existed at all three and each cause already had
 * its own words; what did not exist is HOW MANY, and a narrowed selection printed without a number
 * reads exactly like a complete one.
 *
 * ONE FUNCTION FOR THE THREE, because they are the same promise said three times: the headline is
 * the caller's (each says what its own selection lost), the counting is not. Nothing at all when
 * there is nothing to count — a "0 threads were not read" every tick is the noise that hides the
 * line that matters.
 */
export const renderUnreadThreads = (
  failures: readonly ThreadFailure[],
  headline: (count: number) => string,
): string[] =>
  failures.length === 0 ? [] : [headline(failures.length), ...renderThreadFailures(failures)];

/**
 * Dropped fields, one readable line each — for the caller's stderr, beside the failures.
 *
 * Worded as what happened rather than as an error: the conversation IS in the answer, one field
 * of one message is not, and the reader's action is to look at that file (usually: this process
 * is older than the field it just met).
 */
export const renderThreadWarnings = (warnings: readonly ThreadWarning[]): string[] =>
  warnings.map(
    (warning) =>
      `thread '${warning.id}', ${warning.file}: the field was DROPPED and the thread read without it — ${warning.problem}`,
  );

/**
 * Off-canon spellings, one readable line each — beside the failures and the warnings.
 *
 * Worded as what was read rather than as a loss, because nothing was lost: the whole point of
 * the tolerance is that the conversation is complete. What the line buys is the second half of
 * (iv) — the file stays off-canon in git forever, so the only thing that can say so is the
 * reader, every time it reads it.
 */
export const renderThreadNotices = (notices: readonly ThreadNotice[]): string[] =>
  notices.map(
    (notice) =>
      `thread '${notice.id}', ${notice.file}: read in an OFF-CANON spelling — ${notice.problem}`,
  );
