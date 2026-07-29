/**
 * Reading the conversations directory from disk. The only layer that knows about
 * `fs`: everything above is "string → string" functions and is therefore tested
 * without a file system.
 *
 * TWO FORMS LIVE SIDE BY SIDE and are told apart by the presence of `messages/`:
 * a migrated thread — read the files; a non-migrated one — parse the legacy
 * `_thread.md`. Only this way do threads migrate one at a time, without a
 * "switch-over day" and without downtime of the circuit.
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

/** Result of walking the directory: parsed threads and broken ones, separately. */
export type LoadedThreads = {
  readonly threads: readonly LoadedThread[];
  readonly failures: readonly ThreadFailure[];
};

export const loadThread = (
  dir: string,
  id: string,
  knownRoles: readonly string[],
): LoadedThread => {
  const messagesDir = join(dir, "messages");
  const threadDocPath = join(dir, "_thread.md");
  const metaPath = join(dir, "_meta.md");

  if (!existsSync(messagesDir)) {
    const raw = readFileSync(threadDocPath, "utf8");
    return { thread: parseLegacyThread(id, raw, knownRoles), legacy: true };
  }

  // A HALF-MIGRATED THREAD is called by its name. The form is told apart by the
  // presence of `messages/`, so a message file dropped into a legacy thread by
  // hand (bypassing `new-message`, which refuses to make such a write) moves the
  // thread onto the migrated branch — and that one fails on the missing
  // `_meta.md`. A raw ENOENT on a file path would make the reader infer the state
  // themselves.
  if (!existsSync(metaPath)) {
    throw new Error(
      `half-migrated thread: 'messages/' is present but '_meta.md' is missing` +
        (existsSync(threadDocPath)
          ? " (a legacy '_thread.md' lies next to it — either finish migrating the thread or put the message back into it)"
          : ""),
    );
  }

  const meta = parseMetaFile(readFileSync(metaPath, "utf8"));
  // Order comes from `seq` (`compareMessageEntries`), NOT from the file name: the
  // name leads with a date, and the date is sometimes non-monotonic against the
  // feed (msg-069 in 012). We read first and sort with the comparator afterwards —
  // a flat `.sort()` of names would lie.
  const entries: MessageEntry[] = readdirSync(messagesDir)
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

  for (const name of readdirSync(root)
    .filter((entry) => THREAD_DIR.test(entry) && statSync(join(root, entry)).isDirectory())
    .sort()) {
    try {
      threads.push(loadThread(join(root, name), name, knownRoles));
    } catch (error) {
      failures.push({ id: name, problem: (error as Error).message });
    }
  }

  return { threads, failures };
};

/** Broken threads, one readable line each — for the caller's stderr. */
export const renderThreadFailures = (failures: readonly ThreadFailure[]): string[] =>
  failures.map((failure) => `thread '${failure.id}' could not be read: ${failure.problem}`);
