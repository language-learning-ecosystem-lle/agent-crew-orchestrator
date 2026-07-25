/**
 * MIGRATION 1 → 2: message provenance (R7, thread `016-protocol-roadmap`).
 *
 * Version 2 adds two header fields, `worker` and `session` — what wrote a message,
 * as opposed to which role said it (`thread/message.ts` carries the argument). They
 * are optional on read, so nothing in the feed becomes unreadable; what this step
 * does is state the ABSENCE explicitly on everything already written:
 * `worker: unknown` means "provenance was not recorded then", and after the step it
 * is the only meaning silence can have on an older file.
 *
 * WHY IT TOUCHES COMMITTED MESSAGES AT ALL — and how it earns the right. The feed is
 * append-only without exceptions (john's rule, 2026-07-22); a migration is the one
 * admissible rewrite, and admissible for exactly one reason, PROVABILITY (curator,
 * 2026-07-25, boundaries a/b/c in the README). Hence this step does not re-render a
 * message. Re-rendering would be the natural implementation and it is the wrong one:
 * measured on the live mail, 120 of 327 message files do not survive a
 * parse → render round trip byte for byte (they carry one extra trailing newline,
 * from writers that predate the CLI). A re-render would silently "tidy" all 120 —
 * that is, change bytes it was never asked to change, in files nobody may edit.
 *
 * So the step performs ONE TEXT INSERTION into the front matter and proves it the
 * strongest way available: DELETE THE INSERTED LINE FROM THE RESULT AND THE ORIGINAL
 * COMES BACK, byte for byte. That is the same class of guard as the thread
 * migration's (the assembly must reproduce the source byte for byte), and it makes
 * boundary (a) — "form and metadata only, never the text and never the authorship" —
 * a checked fact rather than an intention.
 *
 * WHAT IT DOES NOT TOUCH:
 *  - `session` on history: the id of a run that ended before the field existed cannot
 *    be recovered, and inventing one would be the only truly unforgivable edit here;
 *  - legacy threads (`_thread.md` with no `messages/`): they have no message files to
 *    stamp. They receive their `worker: unknown` when they move, from the thread
 *    migration itself (`thread/migrate.ts`);
 *  - anything outside `messages/*.md`, `_meta.md` and `_thread.md` included: the
 *    derived file is rebuilt by `derive`, and the meta has no provenance to state.
 */
import { parseMessageFile, WORKER_UNRECORDED } from "../thread/message.js";
import type { MigrationContext, MigrationEffect, MigrationFile, MigrationStep } from "./step.js";
import { MigrationRefusedError } from "./step.js";

const FENCE = "---";
const WORKER_LINE = `worker: ${WORKER_UNRECORDED}`;

/** Is this path a message file of a thread — `<mail>/<thread>/messages/<name>.md`? */
export const isMessagePath = (path: string): boolean =>
  path.endsWith(".md") && path.includes("/messages/");

/**
 * The insertion itself: `worker: unknown` right after the `from:` line of the front
 * matter — where the renderer puts it for new messages, so migrated and new files
 * read the same.
 *
 * Every refusal below is about a file this step cannot prove anything about, and a
 * refusal aborts the WHOLE chain before a byte is written (property 2 of the frame).
 * A migration that skips what it does not understand leaves data half in each shape,
 * which is the state the version number exists to make impossible.
 */
export const insertWorkerLine = (raw: string, path: string): string => {
  const lines = raw.split("\n");
  if (lines[0] !== FENCE) {
    throw new MigrationRefusedError(
      `'${path}': the file does not start with '---' — not a message`,
    );
  }
  const close = lines.indexOf(FENCE, 1);
  if (close === -1) {
    throw new MigrationRefusedError(`'${path}': the message header is not closed ('---')`);
  }
  const at = lines.findIndex(
    (line, index) => index > 0 && index < close && line.startsWith("from:"),
  );
  if (at === -1) {
    throw new MigrationRefusedError(
      `'${path}': the header has no 'from:' line to place 'worker' after`,
    );
  }

  const migrated = [...lines.slice(0, at + 1), WORKER_LINE, ...lines.slice(at + 1)].join("\n");

  // THE PROOF, and it is exact: strike the inserted line out of the result and the
  // original must come back, byte for byte. Nothing else was touched — not the body,
  // not the authorship, not the trailing newlines this file happens to carry.
  const check = migrated.split("\n");
  check.splice(at + 1, 1);
  if (check.join("\n") !== raw) {
    throw new MigrationRefusedError(
      `'${path}': the insertion is not provable — removing the added line does not reproduce the original file`,
    );
  }
  // And the result must still be a message, with exactly the field we meant to add.
  const before = parseMessageFile(raw);
  const after = parseMessageFile(migrated);
  if (after.text !== before.text) {
    throw new MigrationRefusedError(`'${path}': the body of the message changed — refused`);
  }
  if (after.fields.from !== before.fields.from || after.fields.worker !== WORKER_UNRECORDED) {
    throw new MigrationRefusedError(`'${path}': the header did not come out as intended — refused`);
  }
  return migrated;
};

const planProvenance = (context: MigrationContext): MigrationEffect => {
  const files: MigrationFile[] = [];
  let stamped = 0;
  let already = 0;

  for (const path of context.list(context.mailRoot)) {
    if (!isMessagePath(path)) continue;
    const raw = context.read(path);
    // A file that already states its provenance is left alone: the step is
    // idempotent by fact, not by a flag somewhere — running it twice writes nothing
    // the second time.
    //
    // An unreadable file becomes a REFUSAL of the whole chain rather than a raw
    // parse error: to the operator these are the same event ("the migration did not
    // run"), and only one of the two says which file and what to do about it.
    let existing: string | undefined;
    try {
      existing = parseMessageFile(raw).fields.worker;
    } catch (error) {
      throw new MigrationRefusedError(
        `'${path}': the file does not read as a message (${(error as Error).message}) — the migration is not started`,
      );
    }
    if (existing !== undefined) {
      already += 1;
      continue;
    }
    files.push({ path, content: insertWorkerLine(raw, path) });
    stamped += 1;
  }

  return {
    files,
    notes: [
      `messages stamped 'worker: ${WORKER_UNRECORDED}': ${stamped}${already === 0 ? "" : `, already carrying provenance: ${already}`}`,
      "the mail goes straight into its branch, the config through a PR — they are two commits, mail first",
      "threads still in the legacy form receive their provenance when they move (thread migrate), not here",
    ],
  };
};

export const MESSAGE_PROVENANCE_STEP: MigrationStep = {
  from: 1,
  summary:
    "message provenance: history is stamped 'worker: unknown' (the field was not recorded then)",
  plan: planProvenance,
};
