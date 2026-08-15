/**
 * MIGRATION 16 → 17: the dictionary of authorized signatures is DECLARED, not known
 * (thread `080-extraction-prep`, 080.9).
 *
 * Version 17 gives the config one optional top-level key — `identityDictionary` — and takes
 * the matching constant out of the package. Until now `doctor` pointed the operator at
 * `docs/protocol-reference.md`: one project's file name compiled into a tool designed to
 * travel. In any other repository that pointer resolves to nothing, and a pointer at a file
 * that is not there is worse than no pointer at all — the operator goes looking, finds
 * nothing, and reads it as the circuit being broken.
 *
 * NOTHING IS WRITTEN BY THE STEP, and that is deliberate: a migration that invented
 * `identityDictionary: "docs/protocol-reference.md"` for every repository would re-create
 * the default it is removing, one repository at a time. The project that HAS such a file
 * declares it by hand in the same PR (LLE does, and the declaration is today's truth);
 * a project that has none says nothing and gets rows that name the absence as a FACT.
 *
 * ABSENCE IS NEVER A CROSS. A repository without a dictionary is a legitimate repository:
 * the verdict of those two rows is about the box's SIGNATURE, and the dictionary is only
 * the address the reader is sent to. A foreign project raising the tool on its first day
 * must get a green `doctor` with a fact in it, not a red one — that is the property #299
 * established for a declared-but-missing file, and it holds unchanged for an undeclared one.
 *
 * WHY IT IS A VERSION, the field being optional — the reason of v15 and v16 verbatim: the
 * config schema is strict, so a build older than the field answers `Unrecognized key:
 * identityDictionary`, which is invalid, true and useless. The number is the one thing that
 * turns that into "the config is newer than this build, restart what is running on it".
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const IDENTITY_DICTIONARY_STEP: MigrationStep = {
  from: 16,
  summary:
    "the dictionary of authorized signatures as a declaration: the optional top-level 'identityDictionary' path — the tool asks the served project instead of knowing one project's file name; the config schema widens, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'identityDictionary' is OPTIONAL and the step declares it for nobody: a migration that filled it in would re-create the default it removes, one repository at a time",
      "a project WITH a dictionary declares the path itself (relative to the repository being served) — the two identity rows of 'doctor' then point at it and say whether the file is actually there",
      "a project WITHOUT one stays silent and the rows say so — that is a FACT and not a cross: the verdict of those rows is about the box's signature, not about the repository's documentation",
      "the mail is not touched: this version says nothing about message headers",
    ],
  }),
};
