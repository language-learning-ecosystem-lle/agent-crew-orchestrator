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
  /**
   * A NOTE IS NOT A VIOLATION — it is said out loud and does not fail the check.
   * The class exists for exactly one situation: a fact about the feed's PAST that
   * the current version has an opinion about and that nobody may edit (decision
   * curator, thread 024, msg-010).
   */
  readonly severity?: "note";
};

/**
 * WHICH declaration is the turn of the thread — the LAST one, and only while the
 * thread is open. The same rule as `waitingOnOf`, and it is the same rule on
 * purpose: what `check` judges must be what the index and `mail` show, otherwise
 * the checker has an opinion about a state nobody acts on.
 */
const currentTurnFile = (input: ThreadInput): string | undefined => {
  if (input.meta.status === "closed") return undefined;
  for (let at = input.entries.length - 1; at >= 0; at--) {
    const entry = input.entries[at];
    if (entry !== undefined && entry.message.fields.waitingOn !== undefined) return entry.fileName;
  }
  return undefined;
};

export const checkThread = (input: ThreadInput, registry: RoleRegistry): CheckIssue[] => {
  const issues: CheckIssue[] = [];
  const at = (file: string, message: string): void => {
    issues.push({ thread: input.id, file, message });
  };
  const turnFile = currentTurnFile(input);

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
    const awaited = fields.waitingOn ?? undefined;
    if (awaited !== undefined) {
      if (!registry.isKnown(awaited)) {
        at(entry.fileName, `'waiting-on' names role '${awaited}', which is not in the config`);
      } else if (!registry.canHoldTurn(awaited)) {
        // R24: the turn is a tact of the FEED, and a role nobody wakes has no tact —
        // a wait on it reads as a state of the thread while it is really a state of a
        // human's day. What is meant is "somebody must get a decision out of them",
        // and that is a turn for whoever carries the question.
        //
        // ONLY THE THREAD'S CURRENT TURN IS A VIOLATION (decision curator, thread 024,
        // msg-010). The feed is append-only, so the header of an older message is a
        // QUOTATION of a past state, not a claim about the present — and the turn
        // there really did rest on that role, under a version that allowed it. A
        // validator that condemns history makes `check` permanently red, and a
        // permanently red check stops being read: the same defect ("stale is
        // indistinguishable from fresh") the door exists to prevent, only louder.
        // Rewriting those headers is not the way out either — that would be
        // falsifying the journal to get a green tick.
        const historical = entry.fileName !== turnFile;
        issues.push({
          thread: input.id,
          file: entry.fileName,
          message: historical
            ? `'waiting-on: ${awaited}' — the role wakes itself (wake.mode='self') and holds no turn since schema v13; this declaration is not the thread's current turn, so it was written under an earlier version and stands as history (the feed is append-only)`
            : `'waiting-on: ${awaited}' — the role wakes itself (wake.mode='self') and is outside the domain of the turn; the turn goes to whoever carries the question to them`,
          ...(historical ? { severity: "note" as const } : {}),
        });
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
