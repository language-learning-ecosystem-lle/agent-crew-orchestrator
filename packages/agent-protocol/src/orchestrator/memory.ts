/**
 * WHERE A ROLE'S PERSONAL MEMORY LIVES — the first half of form D (LLE thread
 * `116-role-memory-cost`, john's word «D, рядом с почтой, с потолком»).
 *
 * THE DEFECT THIS ANSWERS. The vendor keeps a role's notes in the agent profile,
 * and it keys them by PROJECT DIRECTORY AND ACCOUNT rather than by role: a session
 * running in `.worktrees/dev-speech` writes into the pile of the repository root, so
 * two roles on one account share one pile, and one role on two accounts has two piles
 * that never see each other. Measured on 2026-08-30: ACO/`lle-main` 82 notes,
 * ACO/`lle-second` 7, LLE/`lle-second` 2, LLE/`lle-main` 0. A role therefore has no
 * memory of its own and no access to all of its own — it gets a random slice of
 * "which box raised me".
 *
 * WHAT IS FIXED HERE AND WHAT IS NOT. This module answers two of john's three
 * requirements: WHICH DIRECTORY the raised session is pointed at (and it answers with
 * the role's id, not the project's path), and the CEILING on the index that every
 * session pays for. The third — carrying the directory to and from the mail branch, so
 * that a note survives a box and curator's deletion is a deletion rather than a
 * decoration (constraint К-3) — is NOT here, and until it lands the notes are local to
 * the box. The seam it hangs off is `roleMemoryDirectory`: restore before the raise,
 * save after the release, with the mail checkout clean in between.
 *
 * WHY OUTSIDE EVERY CHECKOUT, MEASURED AND NOT PREFERRED (curator's constraint К-1).
 * The obvious shape — put the notes in the mail checkout, beside the mail they are
 * meant to be visible with — breaks the mail for the WHOLE BOX: delivery reads
 * `git status --porcelain` of the mail checkout and refuses on any non-empty line,
 * untracked included (`thread/deliver.ts`), and its retry path runs `reset --hard`.
 * The vendor writes a note at a moment it picks itself, so a note written mid-flight
 * would block the next delivery of ANY role on the box and then be wiped by the first
 * rejected push. The state directory has neither property: it is the daemon's own,
 * ignored by git, and nothing reads its cleanliness.
 */
import { statSync } from "node:fs";
import { join } from "node:path";

/**
 * The settings object a session is raised with — ONE shape, stated once. It grew a
 * second field the day memory arrived, and that is precisely why it stopped being an
 * expression inline in the argv builder: two callers assembling "the settings" is how
 * one of them ends up shadowing the other's key.
 */
export type SessionSettings = {
  readonly permissions?: { readonly deny: readonly string[] };
  /**
   * The vendor's key (`autoMemoryDirectory`, present in the pinned binary — checked,
   * not remembered). Its SEMANTICS are the vendor's and are not tested by us: we
   * observe them on a live round (curator's «Проверяемость»), we pin only that the
   * path we hand over is derived from the role.
   */
  readonly autoMemoryDirectory?: string;
};

/** Names inside the state directory are the package's convention (see `paths.ts`). */
export const MEMORY_DIR = "memory";

/**
 * THE ROLE IS THE KEY, and the whole point of the module is that this is the only
 * place that says so. `join` and not a template: the base comes from the config, and
 * a config that ends its path with a separator is not a special case anybody should
 * have to remember.
 */
export const roleMemoryDirectory = (input: {
  readonly memory: string;
  readonly role: string;
}): string => join(input.memory, input.role);

/**
 * THE SETTINGS SOURCE IS NOW ALWAYS PASSED, AND THAT IS A CHANGE OF CONTRACT WORTH
 * SAYING OUT LOUD (curator's constraint К-2). Before memory, the flag was omitted
 * whenever the role had no zones, on the stated ground that "a settings source that
 * says nothing is still a settings source, and it would shadow whatever the workspace
 * configures on its own". Every role has memory, so from here the source says
 * something for every role and the flag travels for every role — the shadowing is no
 * longer a hypothetical avoided, it is a fact accepted, and the reason it is
 * acceptable is that the object below names ONLY the two keys we decide and leaves
 * every other key of the workspace's own settings untouched.
 *
 * `undefined` survives as a return value for the one case that is still honestly
 * silent: no zones AND no memory directory, which is what every caller that has not
 * been taught about memory yet passes.
 */
export const sessionSettings = (input: {
  readonly deny?: readonly string[];
  readonly memoryDirectory?: string;
}): SessionSettings | undefined => {
  const deny = input.deny ?? [];
  const settings: SessionSettings = {
    ...(deny.length === 0 ? {} : { permissions: { deny } }),
    ...(input.memoryDirectory === undefined ? {} : { autoMemoryDirectory: input.memoryDirectory }),
  };
  return Object.keys(settings).length === 0 ? undefined : settings;
};

/**
 * THE INDEX IS THE THIRD AXIS, AND THE ONLY ONE THAT GROWS MONOTONICALLY (john's word,
 * msg-004 §3: «потолок оглавления обязателен»). `MEMORY.md` is loaded into the starting
 * text of EVERY session of the project, so it is paid by 100 % of runs rather than by
 * the 13 % that write. Measured on 2026-08-30: 19 294 bytes in this circuit ≈ 5.5k
 * tokens ≈ 4 % of a session's cache reads, with no limiter of any kind.
 *
 * WHY BYTES AND NOT NOTES OR AGE. Bytes are what is actually paid — a hundred one-line
 * notes cost less than ten essays, and age says nothing about price. The number is the
 * measured index of the worst circuit today rounded to a round figure: it does not fire
 * on any pile that exists (LLE 267 bytes, ACO 19 294), and it fires on the next
 * doubling. A ceiling that already fires on the day it lands teaches everyone to ignore
 * it.
 */
export const MEMORY_INDEX_LIMIT_BYTES = 24_576;

/** The index file the vendor loads into every session's starting text. */
export const MEMORY_INDEX = "MEMORY.md";

/**
 * THE CEILING IS A MECHANISM, NOT AN AGREEMENT (john's requirement), AND ITS FIRING IS
 * LOUD — a line, by name, with both numbers in it. What it is NOT is a refusal to raise
 * the session, and that is curator's measured recommendation adopted whole: stopping the
 * circuit over a table of contents costs more than the table of contents does. It is also
 * NOT a silent truncation — a pile quietly cut is a pile whose owner never learns it grew.
 *
 * Pure, and given the size rather than the path, so the sentence a human reads is pinned
 * by a test instead of by a directory that happens to exist on one box.
 */
export const memoryIndexAlarmFor = (input: {
  readonly role: string;
  readonly bytes: number;
  readonly limit?: number;
}): string | undefined => {
  const limit = input.limit ?? MEMORY_INDEX_LIMIT_BYTES;
  return input.bytes <= limit
    ? undefined
    : `memory: the index of '${input.role}' is ${input.bytes} bytes against a ceiling of ${limit} — it is loaded into the starting text of EVERY session of this role, so it is paid by every run and not by the runs that write it; prune it (a note that has moved into the role card, or one the card now contradicts, is a note that should be deleted, not shortened)`;
};

/**
 * THE SAME QUESTION ASKED OF THE DISK, at the one moment it can be asked cheaply — the
 * raise. A missing index (a role that has never written a note) is not an alarm and not
 * an error: it is the normal first day. Anything else the file system refuses to say is
 * swallowed for the same reason the state directory is disposable — a ceiling that can
 * break a launch is worse than a ceiling that goes unread once.
 */
export const memoryIndexAlarm = (input: {
  readonly directory: string;
  readonly role: string;
  readonly limit?: number;
}): string | undefined => {
  try {
    const bytes = statSync(join(input.directory, MEMORY_INDEX)).size;
    return memoryIndexAlarmFor({
      role: input.role,
      bytes,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  } catch {
    return undefined;
  }
};
