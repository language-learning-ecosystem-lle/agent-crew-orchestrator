/**
 * MIGRATION 25 → 26: WHAT THE ROUND OF REVIEW IS CALLED IS DECLARED BY THE PROJECT — the
 * optional top-level `review: { label, workflow }`, thread `063-state-model-rewrite`
 * (john, 2026-09-03, «1 — КОНФИГ»; the precedent is `powerDocuments`, john's decision of
 * 2026-08-21, thread `025-power-docs-as-data`).
 *
 * WHAT WIDENED. One optional key and two free strings under it: the name of the GitHub
 * label a role hangs to open a round, and the name of the workflow that answers it. Both
 * are facts about ONE repository — this package travels, and a label called `review` here
 * is called something else in the next contour. The reader that needs them is the frame's
 * merge-ready tier, which until now could not say "this pair is waiting for a round of
 * review" at all: the pair showed as `released (completed)`, "finished", while its pull
 * request stood open (`docs/state-model.md`, §5 state 2).
 *
 * WHY NOT A FLAG — the argument that decided it, and it is the argument this whole thread
 * exists on: an unfilled flag means the tier says NOTHING and says it SILENTLY, which is
 * exactly the door the rewrite of the state model was opened to kill. A missing DECLARATION
 * is read as "this project has not named its round"; a missing flag is read as nothing at
 * all.
 *
 * NOTHING IS WRITTEN BY THE STEP, and it declares the value for nobody — the reason of v18
 * and v25 verbatim. Which label opens a round is a judgement about one repository, and a
 * migration that filled it in would compile one project's vocabulary into a package built
 * to travel. A project WITH a round writes it by hand in the same PR; a project without the
 * key keeps today's behaviour BIT FOR BIT: the tier stays silent about review rounds and the
 * order of the queue is untouched either way.
 *
 * WHY IT IS A VERSION, the field being optional — the reason of v15 through v25 verbatim:
 * the config schema is strict, so a build older than the field answers `Unrecognized key:
 * review`, which is invalid, true and useless. The number is the one thing that turns that
 * into "the config is newer than this build, restart what is running on it".
 *
 * WHAT THIS VERSION DELIBERATELY DOES NOT REACH. `merge-gate` keeps taking the name of the
 * reviewer's workflow as `--review-workflow` on its command line. Making the DOOR read it
 * from the config is a separate norm and a separate ascent (john, same word: the boundary
 * he did not widen) — and the two readers are not interchangeable, because the door is
 * invoked by hand against a repository the config may not even describe.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const REVIEW_ROUND_STEP: MigrationStep = {
  from: 25,
  summary:
    "the round of review as a declaration: the optional top-level 'review' — the name of the label that opens a round and the name of the workflow that answers it move out of words compiled into the package and into the served project's config, so the frame can say 'waiting for a round of review' instead of 'finished'; the config schema widens, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'review' is OPTIONAL and the step declares it for nobody: which label opens a round of review is a judgement about one repository, and a migration that filled it in would compile one project's vocabulary into a package built to travel",
      "a project WITH a round writes both halves itself — 'review.label' is the GitHub label a role hangs, 'review.workflow' is the name of the workflow that answers it (the 'name:' of its workflow file, not the file name)",
      "a project WITHOUT the key keeps today's behaviour bit for bit: the merge-ready tier says nothing about rounds of review, and the ORDER of the queue is untouched in both cases — this field is read to SAY a state, never to move a pair",
      "'merge-gate' is not touched: the door keeps taking the reviewer's workflow as '--review-workflow' on its command line, and making it read the config is a separate ascent",
    ],
  }),
};
