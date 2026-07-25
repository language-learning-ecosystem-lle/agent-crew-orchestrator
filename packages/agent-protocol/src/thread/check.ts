/**
 * The format validator — the only defence the new model has.
 *
 * A trade-off taken deliberately (john's decision, msg-005 of thread 012):
 * corrupting the body of a thread becomes IMPOSSIBLE by construction (a writer
 * only touches its own file), while a malformed format becomes CATCHABLE
 * IMMEDIATELY. Since writing no longer goes through code, a check after the write
 * is all we have, and therefore it must be picky.
 *
 * What is checked and why exactly this:
 *
 * - **`from` and the roles in `waiting-on` are known to the registry.** In the old
 *   parser an unknown role was dropped SILENTLY — that was the very mechanism by
 *   which a role got lost from a declaration (pain 2). A typo like `jonh` would
 *   yield an empty waiting and a silence indistinguishable from normal work.
 * - **The file name matches the fields.** The name is the message identifier; once
 *   it drifts from the content it stops being one.
 * - **No `## msg-` lines in the body** — they would break the assembly: the
 *   assembler cuts a thread exactly at them.
 * - **The body is non-empty** — an empty message in the feed is silence that looks
 *   like a turn.
 * What is DELIBERATELY NOT here: a "dates do not decrease in thread order" check.
 * Order is held by `seq` (position), not by the date, and the date may be
 * non-monotonic with the feed ON PURPOSE — writer clock skew, the UTC midnight
 * boundary (the real msg-069 in 012). Requiring monotonic dates would be WRONG,
 * not merely redundant. The genuinely adjacent check — "order against COMMIT
 * order" — lives on the git layer next to the immutability check, not here.
 * - **The assembled `_thread.md` matches the committed one** — otherwise the
 *   derived file has drifted from the source and a human is reading something
 *   other than what is there.
 * - **Previously committed files have not changed** (`checkImmutable`, enabled by
 *   the `--since <ref>` flag: without a point in history the question "was it
 *   edited after the fact" makes no sense, and staying silent about that would
 *   read as "intact"). The file-per-message model makes a quiet retroactive edit
 *   cheap: the diff is tiny, the feed looks the same. Technically we do not forbid
 *   the edit, but it must leave a red trace — that role used to be played by the
 *   physics of a shared file.
 */
import type { RoleRegistry } from "../roles/registry.js";
import { type Message, messageFileName } from "./message.js";
import { renderThread, type ThreadMeta } from "./thread.js";

export type MessageEntry = {
  readonly fileName: string;
  readonly message: Message;
};

export type ThreadInput = {
  readonly id: string;
  readonly meta: ThreadMeta;
  /** Messages IN THREAD ORDER (`compareMessageEntries`, by `seq`) — the same one the assembler uses. */
  readonly entries: readonly MessageEntry[];
  /** The committed derived file, if there is one. */
  readonly threadDoc?: string;
};

export type CheckIssue = {
  readonly thread: string;
  readonly file?: string;
  readonly message: string;
};

export const checkThread = (input: ThreadInput, registry: RoleRegistry): CheckIssue[] => {
  const issues: CheckIssue[] = [];
  const at = (file: string, message: string): void => {
    issues.push({ thread: input.id, file, message });
  };

  for (const participant of input.meta.participants) {
    if (!registry.isKnown(participant)) {
      issues.push({
        thread: input.id,
        file: "_meta.md",
        message: `participant '${participant}' is not listed as a role in the config`,
      });
    }
  }

  for (const entry of input.entries) {
    const { fields, text } = entry.message;

    if (!registry.isKnown(fields.from)) {
      at(entry.fileName, `'from: ${fields.from}' — no such role in the config`);
    }
    for (const role of fields.waitingOn ?? []) {
      if (!registry.isKnown(role)) {
        at(entry.fileName, `'waiting-on' names role '${role}', which is not in the config`);
      }
    }

    const expected = messageFileName(fields);
    if (expected !== entry.fileName) {
      at(entry.fileName, `the file name drifted from the header, expected '${expected}'`);
    }

    if (text.trim() === "") at(entry.fileName, "the message body is empty");
    if (/^## msg-/m.test(text)) {
      at(entry.fileName, "a '## msg-' line in the body — the thread assembly would break on it");
    }
  }

  if (input.threadDoc !== undefined) {
    const rendered = renderThread(
      input.meta,
      input.entries.map((entry) => entry.message),
    );
    if (rendered !== input.threadDoc) {
      issues.push({
        thread: input.id,
        file: "_thread.md",
        message: "the derived file drifted from the messages — rebuild it",
      });
    }
  }

  return issues;
};

/**
 * Previously committed message files are immutable. `previous`/`current` are
 * "path → content" maps from two states of the branch.
 */
export const checkImmutable = (
  previous: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): CheckIssue[] => {
  const issues: CheckIssue[] = [];
  for (const [path, was] of previous) {
    const now = current.get(path);
    if (now === undefined) {
      issues.push({ thread: path, message: "message file deleted — the feed is append-only" });
      continue;
    }
    if (now !== was) {
      issues.push({
        thread: path,
        message: "message file changed after the commit — a retroactive edit",
      });
    }
  }
  return issues;
};

export type { Message };
