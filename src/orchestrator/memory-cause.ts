/**
 * WHAT KILLS A NOTE, BESIDES A HAND (thread `090-what-kills-a-note`, john's word of
 * 2026-09-03 through curator's `delivers`).
 *
 * THE DEFECT THIS ANSWERS. `memory.ts` put a CEILING on the index and `memory-sync.ts`
 * made a deletion a deletion — but both leave the deleting to a hand: the ceiling prints
 * a line and does not refuse the raise (deliberately), so when it fires the answer to it
 * is curator, every tick, with the same string. Measured on 2026-09-03: curator's index
 * 23 268 bytes of the 24 576 ceiling (94.7 %), growing ≈1000 bytes a day.
 *
 * WHY NOT A LIFETIME (the shape this replaces, and john's objection that killed it).
 * A date in the note — `expires`/`review-by` — was the cheap answer, and it is wrong for
 * BOTH sorts of note there are:
 *
 *  - a note about HOW THE WORLD IS BUILT («the hour declared measured is measured at the
 *    moment of the declaration», «a tag's name promises neither version nor content») is
 *    true until the tool changes. A lifetime HURTS it: it burns, the role walks into the
 *    same wall a second time, and we pay exactly the price the note was written to avoid;
 *  - a note about the CURRENT STATE («the door is silent, go around like this», «the pin
 *    lags until the next tag») does go stale — but not on a calendar. It goes stale when
 *    the SUBJECT it was written for is closed.
 *
 * SO THE SORT IS THE POVOD, AND IT IS NOT A SEPARATE FIELD. A note that names the subject
 * it was written for — a thread — is short-lived and dies WITH that subject; a note that
 * names none is long-lived and is never extinguished automatically, ever. The sort is
 * DERIVED from the presence of the cause rather than declared beside it, because a second
 * field is a second thing to forget to fill in, and a note whose sort disagrees with its
 * cause would be a note nobody can reason about.
 *
 * WHAT IS A MECHANISM HERE AND WHAT IS STILL A HAND. The death of a short-lived note is a
 * mechanism: it happens at the materialisation (the restore, `memory-sync.ts`), against
 * the thread's own `status:` in the mail branch, with no judgement and no run. The death
 * of a LONG-LIVED note stays an explicit act of a role or of john — and that is the
 * decision, not an omission: a note about how the world is built may only be killed by
 * naming what refuted it.
 *
 * NOTHING HERE MAY EVER END A RUN, and it may not delete on a doubt either. A cause the
 * branch cannot answer for — a typo, a thread that never existed, a form that is not a
 * thread id — keeps its note ALIVE and says so by name. Silence in the other direction
 * would be a note deleted because somebody misspelled its subject.
 */
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRun } from "../thread/deliver.js";
import { parseMetaFile, type ThreadStatus } from "../thread/thread.js";
import { MEMORY_INDEX } from "./memory.js";
import type { MemorySnapshot } from "./memory-sync.js";

/**
 * THE FIELD A NOTE NAMES ITS SUBJECT WITH — one word, `thread`, inside the front matter
 * the vendor already writes (see `causeOf`). Not a new file and not a new directory: the
 * pile is read by the vendor and everything in it is a note to it, so the only place a
 * cause can live without becoming a note of its own is inside the note.
 */

/**
 * A THREAD ID AND NOTHING ELSE. The value is written by a session into a file and is then
 * spent as a PATH inside the branch, so it is checked against the same shape the mail's
 * own reader walks by (`^\d{3}` plus the point-suffix form, thread `086`) before git is
 * ever asked about it. Anything else is not refused and not obeyed — it is reported (see
 * `planExtinction`): a cause we cannot resolve must never be read as a cause that closed.
 */
const THREAD_ID = /^\d{3}(\.\d+)?-[a-z0-9][a-z0-9-]*$/;

export const isThreadCause = (cause: string): boolean => THREAD_ID.test(cause);

/**
 * THE CAUSE OF ONE NOTE, READ FORGIVINGLY ON PURPOSE. The front matter is the block
 * between the first two `---` fences; inside it, a `thread:` key at ANY depth is the
 * cause. The depth is not asked about because the field is nested under `metadata:` in
 * the form the vendor writes and at the top level in the form a human writes by hand, and
 * a note whose cause is ignored on an indent is a note that quietly became immortal.
 *
 * Line-based and not a YAML parser: the front matter of a note is four keys, and a
 * dependency that can throw on somebody's stray colon would turn a note into a failed
 * raise.
 */
export const causeOf = (content: string): string | undefined => {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return undefined;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") return undefined;
    const match = /^\s*thread:\s*(?<cause>[^#\s][^#]*?)\s*$/.exec(line);
    const cause = match?.groups?.cause;
    if (cause !== undefined) return cause.replace(/^["']|["']$/g, "");
  }
  return undefined;
};

/** One note and the subject it declared, as the plan and the loud lines both need it. */
export type NoteCause = { readonly path: string; readonly cause: string };

export type ExtinctionPlan = {
  /** Short-lived notes whose subject is closed — these die at this materialisation. */
  readonly extinguished: readonly NoteCause[];
  /** Notes that named a subject nothing can answer for. They LIVE, and they are named. */
  readonly unanswered: readonly NoteCause[];
};

/**
 * THE WHOLE RULE, AWAY FROM GIT AND FROM THE DISK, so it can be asked questions:
 *
 *  - no cause → long-lived → never extinguished here, whatever it says about itself;
 *  - cause closed → extinguished;
 *  - cause open → alive, and nothing is said (that is the normal state of a live note);
 *  - cause unresolvable → alive, and SAID, because the alternative is deleting a note
 *    over a typo.
 *
 * The index itself is not a note and is never a candidate: it is rewritten by
 * `pruneIndex` instead, which is the other half of the same death.
 */
export const planExtinction = (input: {
  readonly notes: MemorySnapshot;
  readonly statusOf: (cause: string) => ThreadStatus | undefined;
}): ExtinctionPlan => {
  const extinguished: NoteCause[] = [];
  const unanswered: NoteCause[] = [];
  for (const path of [...input.notes.keys()].sort()) {
    if (path === MEMORY_INDEX) continue;
    const cause = causeOf(input.notes.get(path) ?? "");
    if (cause === undefined) continue;
    const status = isThreadCause(cause) ? input.statusOf(cause) : undefined;
    if (status === undefined) unanswered.push({ path, cause });
    else if (status === "closed") extinguished.push({ path, cause });
  }
  return { extinguished, unanswered };
};

/**
 * THE OTHER HALF OF THE DEATH — the index line goes with the note. The index is what is
 * actually paid (it rides in the starting text of every session of the role), so a note
 * file removed while its pointer stays costs the reader exactly as much as before and
 * leaves a link to nothing. Matched on the LINK TARGET and not on the title: the title is
 * prose and drifts, the target is the file name we just removed.
 */
export const pruneIndex = (input: {
  readonly index: string;
  readonly removed: readonly string[];
}): string => {
  const targets = new Set(input.removed);
  const kept = input.index
    .split("\n")
    .filter((line) => {
      const linked = /\]\((?<target>[^)]+)\)/.exec(line)?.groups?.target;
      return linked === undefined || !targets.has(linked);
    })
    .join("\n");
  return kept;
};

/**
 * THE LOUD LINE OF A DEATH — pinned by a test, and it names BOTH the note and the subject
 * that took it, because the reader's next question is always "why is my note gone".
 */
export const extinctionLine = (input: {
  readonly role: string;
  readonly extinguished: readonly NoteCause[];
}): string =>
  `memory: ${input.extinguished.length} note(s) of '${input.role}' were extinguished by their subject being closed (${input.extinguished
    .map((note) => `${note.path} ← ${note.cause}`)
    .join(
      ", ",
    )}) — a note that names a thread lives as long as that thread is open; a note that names none is never extinguished automatically.`;

/**
 * THE LOUD LINE OF A CAUSE NOTHING ANSWERS FOR. It is not a failure and does not delete:
 * the note stays. What it prevents is the silent outcome — a note that will never die
 * because its subject is spelled wrong, wearing the look of a note that is simply alive.
 */
export const unansweredCauseLine = (input: {
  readonly role: string;
  readonly unanswered: readonly NoteCause[];
}): string =>
  `memory: ${input.unanswered.length} note(s) of '${input.role}' name a subject the mail branch cannot answer for (${input.unanswered
    .map((note) => `${note.path} → ${note.cause}`)
    .join(
      ", ",
    )}) — they are KEPT (a cause we cannot resolve is not a cause that closed), and they will never be extinguished until the name is a thread id that exists.`;

/**
 * THE STATUS OF A THREAD, ASKED OF THE BRANCH AND NOT OF THE TREE — the same rule the
 * restore lives by: the mail checkout is shared by every role on the box, and delivery
 * refuses it dirty, so nothing here checks anything out. Asked once per DISTINCT cause,
 * and only for causes already shaped like a thread id.
 *
 * A `_meta.md` that cannot be read or cannot be parsed answers `undefined` — which the
 * plan reads as "keep the note", never as "close it".
 */
export const threadStatuses = (input: {
  readonly git: GitRun;
  readonly ref: string;
  readonly mailDir: string;
  readonly causes: readonly string[];
}): ReadonlyMap<string, ThreadStatus> => {
  const statuses = new Map<string, ThreadStatus>();
  for (const cause of new Set(input.causes)) {
    if (!isThreadCause(cause)) continue;
    try {
      const raw = input.git(["show", `${input.ref}:${input.mailDir}/${cause}/_meta.md`]);
      statuses.set(cause, parseMetaFile(raw).status);
    } catch {
      // A subject that is not in the branch is a subject we know nothing about — see the
      // note on the return type. Deleting on it would be deleting on a typo.
    }
  }
  return statuses;
};

/**
 * THE MOMENT ITSELF, wired into the restore (`memory-sync.ts`) because that is the one
 * moment the directory can be changed wholesale without racing the vendor, which writes
 * when it pleases.
 *
 * IT DELETES ONLY THE BOX'S COPY, AND THAT IS THE FULL DEATH ANYWAY: the restore has just
 * recorded the branch as the snapshot this session was handed, so a note removed here is
 * `live ≠ restored` at the release and `planSave` carries the removal into the branch as
 * this session's own change. If the save never lands, the note is simply extinguished
 * again at the next raise — the mechanism is idempotent by construction rather than by
 * bookkeeping.
 */
export const extinguishNotes = (input: {
  readonly git: GitRun;
  readonly ref: string;
  readonly mailDir: string;
  readonly role: string;
  readonly directory: string;
  readonly notes: MemorySnapshot;
}): readonly string[] => {
  const causes: string[] = [];
  for (const [path, content] of input.notes) {
    if (path === MEMORY_INDEX) continue;
    const cause = causeOf(content);
    if (cause !== undefined) causes.push(cause);
  }
  if (causes.length === 0) return [];
  const statuses = threadStatuses({
    git: input.git,
    ref: input.ref,
    mailDir: input.mailDir,
    causes,
  });
  const plan = planExtinction({ notes: input.notes, statusOf: (cause) => statuses.get(cause) });
  const lines: string[] = [];
  if (plan.extinguished.length > 0) {
    const removed = plan.extinguished.map((note) => note.path);
    for (const path of removed) rmSync(join(input.directory, path), { force: true });
    const index = input.notes.get(MEMORY_INDEX);
    if (index !== undefined) {
      const pruned = pruneIndex({ index, removed });
      if (pruned !== index) writeFileSync(join(input.directory, MEMORY_INDEX), pruned);
    }
    lines.push(extinctionLine({ role: input.role, extinguished: plan.extinguished }));
  }
  if (plan.unanswered.length > 0)
    lines.push(unansweredCauseLine({ role: input.role, unanswered: plan.unanswered }));
  return lines;
};
