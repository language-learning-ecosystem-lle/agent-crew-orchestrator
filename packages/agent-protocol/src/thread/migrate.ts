/**
 * Migrating a thread from a single `_thread.md` into message files.
 *
 * WHY WITH A GUARD. Splitting rewrites `_thread.md` as a whole, that is, formally
 * it touches OTHER PEOPLE's sections, while the protocol is append-only without
 * exceptions (john's rule, 2026-07-22). The only thing that makes such an
 * operation admissible is provability: the assembly of the migrated files must
 * reproduce the original file **byte for byte**. If it did not, the thread's
 * migration is not accepted, and that is a refusal, not a warning.
 *
 * Byte-exactness is achievable: the assembly canon was verified by a probe on 12
 * live threads (97 sections) BEFORE the implementation.
 *
 * What is preserved deliberately: the historical numbers (duplicates included —
 * thread 012 has two), heading tails such as `[СВЕРХПИСАНО msg-002]`, the original
 * order. References like "see msg-003 item 4" in already-written bodies must keep
 * pointing at what they pointed at. The order is held by `seq` (position) through
 * `compareMessageEntries`, not by the file name: the name leads with a date and
 * the date is sometimes non-monotonic with the feed — see `verifyMigration` (the
 * second condition).
 */
import {
  compareMessageEntries,
  type Message,
  messageFileName,
  parseMessageFile,
  renderMessageFile,
  WORKER_UNRECORDED,
} from "./message.js";
import { parseLegacyThread, renderMetaFile, renderThread, type ThreadMeta } from "./thread.js";

export type MigratedFile = {
  readonly path: string;
  readonly content: string;
};

export type Migration = {
  readonly id: string;
  readonly meta: ThreadMeta;
  readonly files: readonly MigratedFile[];
  /**
   * Two messages yielding one file name. With a name built from `seq` (the
   * position is unique within a thread) this is STRUCTURALLY IMPOSSIBLE out of
   * the current `migrateLegacyThread` — the array is always empty. It is kept NOT
   * as a working defence but as a sanity guard against a future bug in name
   * generation: if `seq` ever stops being unique, the collision is caught here
   * instead of surfacing as a lost message on regeneration. The name used to be
   * built from the duplicated number, and back then this was a real defence; now
   * it is insurance.
   */
  readonly collisions: readonly string[];
};

export const migrateLegacyThread = (
  id: string,
  raw: string,
  knownRoles: readonly string[],
): Migration => {
  const thread = parseLegacyThread(id, raw, knownRoles);
  const collisions: string[] = [];

  // The position (`seq`) is the ordinal index of the section; it goes into the
  // file name and guarantees that sorting names on load = the original order.
  // `msg` (the historical one) stays in the heading for references.
  //
  // `worker: unknown` is stamped for the same reason the schema migration stamps it
  // on history (R7): a `_thread.md` section carries no provenance AT ALL, so the
  // migrated file must say that outright rather than by silence — the threads that
  // are still legacy (009, 010) move AFTER version 2 lands, and a message file with
  // no `worker` written then would be indistinguishable from one whose writer simply
  // failed to record it.
  const seqed: Message[] = thread.messages.map((message, at) => ({
    ...message,
    fields: { ...message.fields, seq: at + 1, worker: WORKER_UNRECORDED },
  }));

  const files: MigratedFile[] = [
    { path: "_meta.md", content: renderMetaFile(thread.meta) },
    ...seqed.map((message) => ({
      path: `messages/${messageFileName(message.fields)}`,
      content: renderMessageFile(message),
    })),
    { path: "_thread.md", content: renderThread(thread.meta, seqed) },
  ];

  const names = new Set<string>();
  for (const file of files) {
    if (names.has(file.path)) {
      collisions.push(`two messages yield one file name: ${file.path}`);
    }
    names.add(file.path);
  }

  return { id, meta: thread.meta, files, collisions };
};

const firstDiff = (a: string, b: string): string => {
  for (let at = 0; at < Math.max(a.length, b.length); at++) {
    if (a[at] !== b[at]) {
      const from = Math.max(0, at - 40);
      return `divergence at byte ${at}: was ${JSON.stringify(
        a.slice(from, at + 20),
      )}, became ${JSON.stringify(b.slice(from, at + 20))}`;
    }
  }
  return "lengths matched, but the contents differ";
};

/**
 * The migration guard — TWO conditions, both mandatory:
 *
 * 1. The assembly FROM MEMORY (messages in the original order) reproduces the
 *    original `_thread.md` byte for byte.
 * 2. The assembly after LOADING FROM DISK (messages ordered by
 *    `compareMessageEntries` via `seq` — exactly the way `loadThread` does it)
 *    yields the same result.
 *
 * The second condition was added because the first is NOT ENOUGH: the order on
 * disk is set by the sort on load, not by memory. While the key was the file NAME,
 * a message got reordered — the historical number is duplicated (011/012), and for
 * merge #27 in 012 the notifier's date turned out to be EARLIER than messages
 * already in the feed. Ordering by `seq` (position) closes that, but the guard
 * must PROVE reproducibility rather than rely on it.
 */
export const verifyMigration = (migration: Migration, original: string): string | undefined => {
  const rebuilt = migration.files.find((file) => file.path === "_thread.md")?.content;
  if (rebuilt === undefined) return "the migration did not assemble _thread.md";
  if (rebuilt !== original) return `assembly from memory: ${firstDiff(original, rebuilt)}`;

  // Simulating loadThread: messages from messages/, ordered by the comparator
  // (by `seq`) — the same one loadThread applies, not by sorting names.
  const fromDisk = migration.files
    .filter((file) => file.path.startsWith("messages/"))
    .map((file) => ({ fileName: file.path, message: parseMessageFile(file.content) }))
    .sort(compareMessageEntries)
    .map((entry) => entry.message);
  const rebuiltFromDisk = renderThread(migration.meta, fromDisk);
  if (rebuiltFromDisk !== original) {
    return `assembly after loading from disk (name sorting): ${firstDiff(original, rebuiltFromDisk)}`;
  }

  return undefined;
};
