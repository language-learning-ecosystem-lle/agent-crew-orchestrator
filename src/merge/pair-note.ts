/**
 * THE NOTE `merge-gate` PRINTS WHEN NOBODY MEASURED THE PAIR — «this pull request × what
 * landed in the base after its credited check started», and only when the two sides are tied
 * by the NARROW sign: one side edits a file that EXECUTES a file the other side edits
 * (thread `136-unmeasured-pair-of-step-and-script`, john's word of 2026-09-06: «ТРЕТЬЯ,
 * ПРЕДУПРЕЖДЕНИЕМ, УЗКИЙ ПРИЗНАК»).
 *
 * WHAT IT IS ABOUT. Two pull requests are each green on their own and the PAIR of them is
 * measured by nobody: a `pull_request` run reads the head merged with the base OF ITS OWN
 * MOMENT, so whatever lands in the base afterwards was never run against this diff. The
 * first reading of the pair is the push run on `main` AFTER the merge — and that one writes
 * to nobody when it is green. Measured by curator over all 278 merges of twenty days
 * (2026-08-17 … 2026-09-06): the narrow sign — one side edits the executor of the other —
 * fires 4 times; the wide one («both sides touched the same file») fires 42 and would land
 * on `cli.ts`, which everybody edits, so it was refused by name. Cost paid by the class in
 * those twenty days: zero. The note is therefore set BY THE CLASS, not by damage.
 *
 * IT ONLY SPEAKS. The exit code of `merge-gate` is untouched in every branch, `curatorMayMerge`
 * never sees this file, and nothing here can throw: a refusal would be a NARROWING of the
 * announced route, which is a norm of its own and john gave a note instead. The same
 * boundary the base note of thread `097` is written to, and for the same reason.
 *
 * IT DOES NOT PROMISE COMPLETENESS, AND IT SAYS SO IN ITS OWN TEXT. What it catches is a
 * LITERAL path name inside a workflow or a shell file. The edges «a test imports a module»
 * and «a step depends on behaviour without naming the file» are not caught AT ALL — curator's
 * words, kept because a door that lets a reader believe it is exhaustive is worse than one
 * that says what it misses.
 *
 * THREE SAID STATES, NOT TWO. A link is printed; a measured absence is SILENT (john's
 * requirement: not a line on an ordinary pull request); a measurement that did not happen is
 * ONE line naming what did not read. Silence in that third case would be indistinguishable
 * from «the door never looked» — the false-silence class already repaired twice in this door
 * (`unpublished`, `unreadable`).
 */

import type { BaseMovePaths } from "./base-note.js";
import type { BaseDrift } from "./gate.js";

/** Which side of the unmeasured pair a path belongs to. */
export type PairSide = "pr" | "base";

/**
 * A path that CAN execute another file — a GitHub workflow or a shell script, and only
 * those. The list is deliberately literal: the sign john chose is «one side edits the
 * executor of the other», and an executor this door can read is one whose text names its
 * callee by path.
 */
export type ExecutorCandidate = {
  readonly path: string;
  readonly side: PairSide;
};

/** The text of a candidate on ITS OWN ref — the PR head for `pr`, the base head for `base`. */
export type CandidateContent =
  | {
      readonly path: string;
      readonly side: PairSide;
      readonly state: "read";
      readonly text: string;
    }
  | {
      readonly path: string;
      readonly side: PairSide;
      readonly state: "unread";
      readonly why: string;
    };

/**
 * HOW MANY FILES THE NOTE IS ALLOWED TO READ. Above it the note says state 3 WITH THE
 * NUMBER — never a silent truncation, which would read as «measured, no link» and be a lie
 * of exactly the shape this door keeps repairing.
 */
export const CONTENT_READS = 24;

const isExecutorPath = (path: string): boolean =>
  /^\.github\/workflows\/.+\.ya?ml$/.test(path) || path.endsWith(".sh");

/**
 * WHICH FILES ARE WORTH READING — pure, so the reader in the CLI decides nothing. Both
 * sides are asked, because the executor can stand on either: the live specimen of thread
 * 136 is `checks.yml` on one side against `review-delivery.integration.sh` on the other, and
 * which of the two travels in the pull request is an accident of the day.
 */
export const executorCandidatesOf = (input: {
  readonly changedPaths: readonly string[];
  readonly movedPaths: readonly string[];
}): readonly ExecutorCandidate[] => [
  ...input.changedPaths
    .filter(isExecutorPath)
    .map((path): ExecutorCandidate => ({ path, side: "pr" })),
  ...input.movedPaths
    .filter(isExecutorPath)
    .map((path): ExecutorCandidate => ({ path, side: "base" })),
];

/** One tie: `executor` (on `side`) names `executed` (on the other side) by literal path. */
export type PairLink = {
  readonly executor: string;
  readonly executorSide: PairSide;
  readonly executed: string;
};

/** The tie is looked for in BOTH directions; a file naming ITSELF is not a pair. */
export const pairLinksOf = (input: {
  readonly contents: readonly CandidateContent[];
  readonly changedPaths: readonly string[];
  readonly movedPaths: readonly string[];
}): readonly PairLink[] => {
  const links: PairLink[] = [];
  for (const content of input.contents) {
    if (content.state !== "read") continue;
    const opposite = content.side === "pr" ? input.movedPaths : input.changedPaths;
    for (const executed of opposite) {
      if (executed === content.path) continue;
      if (content.text.includes(executed))
        links.push({ executor: content.path, executorSide: content.side, executed });
    }
  }
  return links;
};

export type PairNoteInput = {
  readonly drift: BaseDrift;
  /** `files[].path` of the pull request, repository-relative. */
  readonly changedPaths: readonly string[];
  /** The same reading the base note pays for — asked only on `drift`. */
  readonly moved?: BaseMovePaths | undefined;
  /** The candidates actually read; absent when nothing was worth reading. */
  readonly contents?: readonly CandidateContent[] | undefined;
  /** Present only when the ceiling stopped the reads — the number of candidates found. */
  readonly overCeiling?: number | undefined;
};

const sideWord = (side: PairSide): string =>
  side === "pr" ? "changed by THIS pull request" : "landed in the base";

const other = (side: PairSide): PairSide => (side === "pr" ? "base" : "pr");

/**
 * THE FOUR THINGS THE NOTE OWES ITS READER (statement of work §5, from john's msg-003):
 * the paths of both sides by name and whose side each is on; that this is NOT a refusal;
 * that it does not promise completeness; and what it was measured by — which is
 * {@link BaseDrift.detail}, the SAME sentence the base note prints, on purpose: two doors
 * answering one question in two wordings drift apart in a month.
 *
 * Returns the sentences without the command's own prefix, like every other `describe*` here.
 */
export const describePairNote = (input: PairNoteInput): readonly string[] => {
  const { drift } = input;
  // Measured and there is nothing to measure the pair of: silence, and that is john's
  // fourth requirement — not a line on an ordinary pull request.
  if (drift.state === "current") return [];
  if (drift.state === "unknown")
    return [
      "whether this merge has an unmeasured PAIR was NOT measured: the base drift itself is unknown (see the base note above). This is not 'there is no pair' — it is that nothing was read",
    ];

  const moved = input.moved;
  if (moved === undefined || moved.state === "unread")
    return [
      `whether this merge has an unmeasured PAIR was NOT measured: the paths the base moved through were not read (${moved === undefined ? "not asked" : moved.why}). This is not 'there is no pair'`,
    ];

  if (input.overCeiling !== undefined)
    return [
      `whether this merge has an unmeasured PAIR was NOT measured: ${input.overCeiling} executor candidate(s) on the two sides is over the ceiling of ${CONTENT_READS} this note reads, and it truncates nothing silently. This is not 'there is no pair'`,
    ];

  const contents = input.contents ?? [];
  const links = pairLinksOf({
    contents,
    changedPaths: input.changedPaths,
    movedPaths: moved.paths,
  });
  if (links.length === 0) {
    const unread = contents.filter((content) => content.state === "unread");
    if (unread.length > 0)
      return [
        `whether this merge has an unmeasured PAIR was NOT measured: ${unread
          .map((content) => `${content.path} (${content.state === "unread" ? content.why : ""})`)
          .join(
            "; ",
          )} — the file that would have named the tie was not read. This is not 'there is no pair'`,
      ];
    // Measured, no tie: silent by john's fourth requirement.
    return [];
  }

  const lines = [
    `NOBODY MEASURED THIS PAIR — ${links
      .map(
        (link) =>
          `'${link.executor}' (${sideWord(link.executorSide)}) names '${link.executed}' (${sideWord(other(link.executorSide))}) by path`,
      )
      .join(
        "; ",
      )}: one side edits a file that EXECUTES a file the other side edits, and no run has ever read the two together`,
    `measured by: ${drift.detail}`,
    "this is NOT a refusal — the merge is not blocked, no guard changed its answer, and the exit code is the one the guards above give",
    "it does not promise completeness: what is caught is a LITERAL path name inside a workflow or a shell file. 'A test imports a module' and 'a step depends on behaviour without naming the file' are not caught at all",
  ];
  return lines;
};
