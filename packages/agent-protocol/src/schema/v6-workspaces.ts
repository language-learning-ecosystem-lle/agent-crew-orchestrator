/**
 * MIGRATION 5 → 6: the role workspace and the continuation policy (R17 + R18, thread
 * `016-protocol-roadmap`).
 *
 * Version 6 widens two shapes and moves no data:
 *  - the config gains `orchestrator.workdir.worktrees` — where the per-role worktrees
 *    live (R17). Optional: a repository that says nothing keeps the old behaviour,
 *    where a session inherits the checkout it was raised from;
 *  - the journal gains three optional fields on `launch` (`mode`, `resumes`, `world`)
 *    and two on `lease-released` (`session`, `steps`) — what R18 decides against.
 *
 * WHY THE JOURNAL DOES NOT NEED REWRITING, unlike the message headers of 1 → 2. Its
 * new fields are OPTIONAL and describe a run: a line written before this version
 * carries no world and no session id, and the continuation policy reads exactly that
 * as "cannot be shown to be resumable" and starts fresh. Backfilling would mean
 * inventing what an old run saw — the one thing the policy must never be given.
 *
 * WHY IT IS STILL A VERSION, for the fourth time and for the same reason: the config
 * schema is strict, so a build of the package that predates `worktrees` REFUSES a
 * config carrying it. Without the number that refusal reads "unrecognized key:
 * worktrees" and blames the config; with it, "the repository declares 6, the package
 * supports 5 — update the package", which names the repair.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const WORKSPACES_STEP: MigrationStep = {
  from: 5,
  summary:
    "the role workspace (orchestrator.workdir.worktrees) and the continuation fields of the journal — the schema widens, no data changes; the number moves alone",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'worktrees' is OPTIONAL — a repository that says nothing keeps raising sessions in the checkout the daemon was started from; declaring it is what hands each role a worktree of its own",
      "the journal is NOT rewritten: runs recorded before this version carry no world and no session id, and the continuation policy reads that as 'start fresh'",
    ],
  }),
};
