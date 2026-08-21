/**
 * MIGRATION 17 → 18: the documents of power are DECLARED BY THE PROJECT, not remembered
 * by the operator (thread `025-power-docs-as-data`, john's decision of 2026-08-21).
 *
 * Version 18 gives the config one optional top-level key — `powerDocuments` — the DECLARED
 * half of the list guard 4 of `merge-gate` judges by. Until now that half arrived as
 * `--power-docs` on the command line, so the completeness of the guard equalled the memory
 * of whoever typed the invocation: the string lives in a role card and is copied by hand,
 * and a guard held up by a copied string is a door that stays silent. The measurement that
 * decided it (thread `024`, msg-002): of 17 pull requests the merge-ready tier fired on, 4
 * touched documents of power and the DERIVED half of the list would have caught one.
 *
 * NOTHING IS WRITTEN BY THE STEP. The list is a JUDGEMENT about which of a repository's own
 * documents carry authority, and no migration can make that judgement for a repository it
 * has never read — inventing `PROTOCOL.md` for everyone would re-create, one repository at a
 * time, exactly the compiled-in default this package exists not to have (the reason of v17
 * verbatim). The project that has such documents declares them by hand in the same PR; a
 * project that declares nothing keeps today's behaviour bit for bit, because the flag and the
 * derived half are both untouched.
 *
 * WHY IT IS A VERSION, the field being optional — the reason of v15, v16 and v17 verbatim:
 * the config schema is strict, so a build older than the field answers `Unrecognized key:
 * powerDocuments`, which is invalid, true and useless. The number is the one thing that turns
 * that into "the config is newer than this build, restart what is running on it".
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const POWER_DOCUMENTS_STEP: MigrationStep = {
  from: 17,
  summary:
    "the documents of power as a declaration: the optional top-level 'powerDocuments' list — the declared half of guard 4 of merge-gate moves out of the operator's command line and into the served project's config; the config schema widens, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'powerDocuments' is OPTIONAL and the step declares it for nobody: which documents carry authority is a judgement about one repository, and a migration that filled it in would re-create the compiled-in default this package exists not to have",
      "a project WITH such documents lists them itself (paths relative to the repository being served) — guard 4 of 'merge-gate' then adds them to the half it derives from the roles (every role's 'instructions' plus the config itself)",
      "a project WITHOUT the key keeps today's behaviour bit for bit: the derived half and the '--power-docs' flag are both unchanged, and the flag keeps ADDING to the list",
      "the mail is not touched: this version says nothing about message headers",
    ],
  }),
};
