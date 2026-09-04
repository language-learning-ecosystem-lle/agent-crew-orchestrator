/**
 * THE NOTE `pr mergeable` PRINTS BEFORE THE `review` LABEL — «the base moved AFTER the
 * credited green `checks` started» (thread `097-conflict-has-no-signal`, john's word of
 * 2026-09-03, quoted by curator: «ДА, ТОЛЬКО НОТА»).
 *
 * WHAT IT IS ABOUT. The norm says «hang the label after a green `checks` on the current
 * head». The head can be perfectly right and the MEASURE stale: a `pull_request` run reads
 * the head merged with the base OF ITS OWN MOMENT, and a base that moves afterwards does
 * not rerun it. `mergeable` is still `MERGEABLE`, there is no conflict, no round has burnt
 * — and the green the label leans on is a reading of a tree that is no longer the result of
 * this merge. Measured twice in twenty-four hours: #249, thirteen seconds between the green
 * and the base move; #252, four minutes twenty-five seconds. Today the class is caught by
 * exactly one door, `merge-gate`, and only AT THE BUTTON — that is, after the round has
 * already been paid for. Before the label it was caught on 2026-09-03 by a role's hand,
 * which is discipline and not a mechanism.
 *
 * IT ONLY SPEAKS, AND THAT IS john's BOUNDARY, NOT A CONVENIENCE. The exit code of
 * `pr mergeable` is untouched in every branch of this file: `0` on a settled `MERGEABLE`,
 * `1` on everything else. Refusing the label on a stale green would be a NARROWING of the
 * announced route — a norm of its own, and a word of its own from john. This module
 * therefore returns TEXT and nothing else: it has no way to refuse even by mistake.
 *
 * IT SPEAKS IN FACTS, NEVER IN ADVICE. «Re-measure» without the sha of the base, the moment
 * it landed, the name of the credited run and when it started is not a note — the reader
 * cannot check it, and a claim nobody can check is how a door starts being read past. The
 * three of them ride in {@link BaseDrift.detail}, which is the SAME sentence the merge gate
 * prints at the button, on purpose: two doors answering one question in two wordings drift
 * apart in a month, and the one that drifts is always the one nobody reads.
 *
 * AN EMPTY INTERSECTION IS PRINTED TOO, and this is the case the file would be wrong
 * without. A base that moved outside the paths of this PR is INERT — but «inert» is a
 * MEASUREMENT, and silence does not express it: silence is indistinguishable from «the door
 * never looked». The same reasoning as the false-silence class repaired twice in the merge
 * gate (`unpublished`, `unreadable`).
 *
 * THE PATHS ARE THE ONLY THING IT ADDS. Everything else here is the gate's own judgement
 * (`baseDriftOf`) re-used verbatim.
 */

import type { BaseDrift } from "./gate.js";

/**
 * WHICH PATHS THE BASE MOVED THROUGH since the credited check started — a reading that is
 * allowed to fail. It costs two `gh` calls and it is the LAST thing computed, so a refusal
 * of either one degrades to `unread` and the note still says everything it knew: the base
 * moved, and by how much it touches this PR is the part that is unknown. A note that
 * vanished because its optional half failed would be exactly the silence above.
 */
export type BaseMovePaths =
  | { readonly state: "read"; readonly paths: readonly string[] }
  | { readonly state: "unread"; readonly why: string };

export type BaseNoteInput = {
  readonly drift: BaseDrift;
  /** `files[].path` of the pull request, repository-relative. */
  readonly changedPaths: readonly string[];
  /** Asked for — and paid for — only when {@link drift} says `drift`. */
  readonly moved?: BaseMovePaths | undefined;
};

/** At most this many paths are listed by name; the rest are counted. */
const NAMED = 12;

const listed = (paths: readonly string[]): string =>
  paths.length <= NAMED
    ? paths.join(", ")
    : `${paths.slice(0, NAMED).join(", ")} … and ${paths.length - NAMED} more`;

/**
 * The four classes of the statement of work, each its own line and each NAMED — including
 * the one that is an absence («no credited green run was found»), which is a said state and
 * not a crash.
 *
 * Returns the sentences without the command's own prefix: the caller owns how its lines are
 * addressed, and every other `describe*` of this package is written the same way.
 */
export const describeBaseNote = (input: BaseNoteInput): readonly string[] => {
  const { drift } = input;
  if (drift.state === "current")
    return [`the base did not move under the credited 'checks' — ${drift.detail}`];
  if (drift.state === "unknown")
    return [
      `whether the base moved under the credited 'checks' is UNKNOWN — ${drift.detail}. This is not 'it did not': the label may still be hung, and the measure behind the green is the part nobody checked`,
    ];

  const lines = [`the base MOVED after the credited 'checks' started — ${drift.detail}`];
  const moved = input.moved;
  if (moved === undefined || moved.state === "unread") {
    lines.push(
      `the paths the base moved through were NOT read (${moved === undefined ? "not asked" : moved.why}) — whether the shift touches this pull request is unknown, which is not the same as 'it does not'`,
    );
    return lines;
  }
  const changed = new Set(input.changedPaths);
  const shared = moved.paths.filter((path) => changed.has(path));
  if (shared.length === 0) {
    lines.push(
      `the base moved OUTSIDE the paths of this pull request: ${moved.paths.length} path(s) moved, none of them among the ${input.changedPaths.length} this PR changes — the shift is inert BY THIS MEASUREMENT, and that is a reading, not a silence`,
    );
    return lines;
  }
  lines.push(
    `the base moved THROUGH ${shared.length} path(s) this pull request also changes: ${listed(shared)} — the green a 'review' label would lean on measured a tree that no longer results from this merge`,
  );
  return lines;
};
