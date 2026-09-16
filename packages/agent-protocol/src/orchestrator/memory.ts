/**
 * WHERE A ROLE'S PERSONAL MEMORY LIVES — two thirds of form D (a consumer thread on the
 * cost of a role's memory, john's word «D, рядом с почтой, с потолком»); the third third
 * is `memory-sync.ts`, next to this file.
 *
 * THE DEFECT THIS ANSWERS. The vendor keeps a role's notes in the agent profile,
 * and it keys them by PROJECT DIRECTORY AND ACCOUNT rather than by role: a session
 * running in `.worktrees/dev-acme` writes into the pile of the repository root, so
 * two roles on one account share one pile, and one role on two accounts has two piles
 * that never see each other. Measured on 2026-08-30: ACO/`acme-main` 82 notes,
 * ACO/`acme-second` 7, a consumer/`acme-second` 2, a consumer/`acme-main` 0. A role therefore has no
 * memory of its own and no access to all of its own — it gets a random slice of
 * "which box raised me".
 *
 * WHAT IS ANSWERED HERE AND WHAT IS ANSWERED NEXT DOOR. This module answers two of
 * john's three requirements: WHICH DIRECTORY the raised session is pointed at (and it
 * answers with the role's id, not the project's path), and the CEILING on the index that
 * every session pays for. The third — carrying the directory to and from the mail branch,
 * so that a note survives a box and curator's deletion is a deletion rather than a
 * decoration (constraint К-3) — LIVES IN `memory-sync.ts` and landed with these two, in
 * the same PR (#159, its third commit): restore mirrors the branch into the directory
 * before the raise, save
 * carries this session's own changes back at the release, and neither touches the mail
 * checkout's working tree except through delivery. The seam both hang off is
 * `roleMemoryDirectory` below: the directory it names is the box's WORKING COPY, and the
 * branch is the source of truth.
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
 *
 * That constraint is about the directory the VENDOR writes into, at a moment it picks
 * itself. The branch copy of the same notes is written by `memory-sync.ts` at the
 * release and only THROUGH `deliverMessage` — which owns the lock, the dirty check, the
 * retry and the undo — so К-1 is answered by construction there rather than softened.
 */
import { readFileSync } from "node:fs";
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
 * THE ROLE IS THE KEY, and the whole point of the module is that this is the only place
 * that says so about the BOX's copy — the same key inside the mail branch is stated once
 * too, by `memoryBranchPrefix` in `memory-sync.ts`. Both spell the directory's name with
 * `MEMORY_DIR` above — this one through the base `paths.ts` assembles from it, so the two
 * copies cannot drift apart on what the directory is called. `join` and not
 * a template: the base comes from the config, and a config that ends its path with a
 * separator is not a special case anybody should have to remember.
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
 * silent: no zones AND no memory directory. No raise takes that path any more — both
 * places in `cli.ts` that assemble one, the `run` command and the daemon's tick, name the
 * directory — and it is kept because the shape, not the call site, is what makes an empty
 * settings source wrong to hand over.
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
 * on any pile that exists (a consumer's 267 bytes, ACO 19 294), and it fires on the next
 * doubling. A ceiling that already fires on the day it lands teaches everyone to ignore
 * it.
 */
export const MEMORY_INDEX_LIMIT_BYTES = 24_576;

/** The index file the vendor loads into every session's starting text. */
export const MEMORY_INDEX = "MEMORY.md";

/**
 * WHERE THE BYTES WENT, AND WHY THE LINE SAYS THAT INSTEAD OF "DELETE SOMETHING".
 * The line this replaces advised one thing: delete the notes that moved into the role
 * card. Measured on the live index (thread `213`, curator's letter of 2026-09-16, and
 * again by hand on this PR) that advice aims at the SMALLEST bucket and at an action the
 * circuit has forbidden in this stretch — deleting a note is losing a measurement, and
 * the three most obvious candidates were read whole and none of them qualified (thread
 * `210`). A human who reads the alarm learns nothing about where the weight actually is.
 * So the line prints the split instead, and offers no advice at all: the owner of the
 * pile decides, and the number decides for them.
 *
 * THE THREE BUCKETS, DEFINED SO THAT TWO READERS GET THE SAME NUMBER (curator's §3, and
 * the whole reason this is its own exported function pinned on a sample line). The index
 * is a list of `- [Heading](file.md) — a hook in prose`. Per line:
 *
 * - `headings` — the VISIBLE text of every link, what is inside `[…]`;
 * - `addresses` — every link's TARGET, its four bracket bytes, the list marker that opens
 *   the line, the line terminator, and any residue between two links that carries no
 *   letter and no digit (`; `, ` · `, `, ` — a separator is markup, not prose);
 * - `prose` — everything else: hooks, connectives, explanations.
 *
 * A bush line carrying several links is not a special case: it is the same three buckets
 * applied to every link on it. The sum of the three IS the byte length of the input —
 * that is the invariant a test pins, because a split that only roughly adds up is exactly
 * as useless as the advice it replaces.
 */
export type MemoryIndexSplit = {
  readonly bytes: number;
  readonly headings: number;
  readonly addresses: number;
  readonly prose: number;
};

/** `[label](target)`, non-greedy on both halves so a bush line splits link by link. */
const INDEX_LINK = /\[([^\]\n]*)\]\(([^)\n]*)\)/g;
/** What opens a list line: `- `, `* `, `+ `, `1. `, at any indent. */
const LIST_MARKER = /^\s*(?:[-*+]|\d+\.)\s+/;
/** A residue with neither letter nor digit is a separator, and separators are markup. */
const CARRIES_A_WORD = /[\p{L}\p{N}]/u;

const bytesOf = (text: string): number => Buffer.byteLength(text, "utf8");

export const memoryIndexSplit = (index: string): MemoryIndexSplit => {
  let headings = 0;
  let addresses = 0;
  let prose = 0;
  const residue = (text: string): void => {
    if (text.length === 0) return;
    if (CARRIES_A_WORD.test(text)) prose += bytesOf(text);
    else addresses += bytesOf(text);
  };
  // `split` and not a line iterator: the terminators are bytes too, and they are markup.
  const lines = index.split("\n");
  for (const [at, line] of lines.entries()) {
    if (at < lines.length - 1) addresses += 1;
    const marker = LIST_MARKER.exec(line);
    const opened = marker === null ? 0 : marker[0].length;
    addresses += bytesOf(line.slice(0, opened));
    let last = opened;
    INDEX_LINK.lastIndex = opened;
    let link = INDEX_LINK.exec(line);
    while (link !== null) {
      residue(line.slice(last, link.index));
      headings += bytesOf(link[1] ?? "");
      addresses += bytesOf(link[2] ?? "") + "[]()".length;
      last = link.index + link[0].length;
      link = INDEX_LINK.exec(line);
    }
    residue(line.slice(last));
  }
  return { bytes: headings + addresses + prose, headings, addresses, prose };
};

/**
 * THE CEILING IS A MECHANISM, NOT AN AGREEMENT (john's requirement), AND ITS FIRING IS
 * LOUD — a line, by name, with the numbers in it. What it is NOT is a refusal to raise
 * the session, and that is curator's measured recommendation adopted whole: stopping the
 * circuit over a table of contents costs more than the table of contents does. It is also
 * NOT a silent truncation — a pile quietly cut is a pile whose owner never learns it grew.
 *
 * Pure, and given the TEXT of the index rather than the path, so the sentence a human
 * reads is pinned by a test instead of by a directory that happens to exist on one box.
 * The text and not the size, since the split cannot be had from a size — that is the one
 * thing this signature had to give up, and {@link memoryIndexAlarm} pays for it with one
 * read of one ~24 KB file per raise.
 *
 * ONE LINE, STILL. A warning that became a paragraph is paid by every raise of every
 * role (curator's §7), so the split rides inside the same sentence.
 */
export const memoryIndexAlarmFor = (input: {
  readonly role: string;
  readonly index: string;
  readonly limit?: number;
}): string | undefined => {
  const limit = input.limit ?? MEMORY_INDEX_LIMIT_BYTES;
  const split = memoryIndexSplit(input.index);
  return split.bytes <= limit
    ? undefined
    : `memory: the index of '${input.role}' is ${split.bytes} bytes against a ceiling of ${limit} — it is loaded into the starting text of EVERY session of this role, so it is paid by every run and not by the runs that write it; the weight is headings ${split.headings} bytes, addresses and markup ${split.addresses} bytes, prose ${split.prose} bytes`;
};

/**
 * THE SAME QUESTION ASKED OF THE DISK, at the one moment it can be asked cheaply — the
 * raise. A missing index (a role that has never written a note) is not an alarm and not
 * an error: it is the normal first day. Anything else the file system refuses to say is
 * swallowed for the same reason the state directory is disposable — a ceiling that can
 * break a launch is worse than a ceiling that goes unread once. Reading the file rather
 * than stat-ing it widens what can go wrong by exactly nothing: both throw into the same
 * `catch`, and both are answered by silence.
 */
export const memoryIndexAlarm = (input: {
  readonly directory: string;
  readonly role: string;
  readonly limit?: number;
}): string | undefined => {
  try {
    const index = readFileSync(join(input.directory, MEMORY_INDEX), "utf8");
    return memoryIndexAlarmFor({
      role: input.role,
      index,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  } catch {
    return undefined;
  }
};
