/**
 * MIGRATION 2 → 3: per-role run ceilings in the launch profile (R12, thread
 * `016-protocol-roadmap`).
 *
 * Version 3 adds one optional field — `roles[].launch.limits` (`idleSeconds`,
 * `wallClockSeconds`, `maxTurns`). It changes NO DATA: a config written for version
 * 2 is already a valid version 3 config, and not one message, thread or journal
 * line is touched. The step exists anyway, and for a reason worth stating, because
 * it is the first of its kind here.
 *
 * WHY AN ADDED OPTIONAL FIELD IS STILL A VERSION. The schemas are strict on
 * purpose — a typo in a field name must not become a silent default — so an old
 * build of the package REFUSES a config that carries `limits`. Without the number
 * that refusal reads "unrecognized key: limits", which names the config as the
 * culprit; with it, the same situation reads "the repository declares 3, the
 * package supports 2 — update the package", which names the repair. That is the
 * whole argument the version gate was built on in R2, seen from the other side: the
 * gate is not there to move data, it is there so a mismatch says what to do.
 *
 * WHAT THE STEP THEREFORE IS: the number, and nothing else. It returns no files and
 * no config — the runner carries `protocolVersion` itself (property 1 of the frame),
 * which is exactly what a step with no data work needs and no more. The `notes` line
 * says out loud that the rendered config is not to be committed: the runner
 * re-renders JSON, and on a config with hand-written compact objects a one-line bump
 * comes back as a sixty-line diff ("Carry the NUMBER, not the file" in the README).
 *
 * WHO IT IS FOR. In THIS repository the number is edited by hand in the same PR as
 * the schema, and there is nothing for the step to do. It is for a repository that
 * carries this package and is not this one — the package is designed as a foreign
 * one and will move out of here. For such a repository the step is the whole answer
 * to "my config is at 2, what do I do": run the migration, nothing else changes.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const LAUNCH_LIMITS_STEP: MigrationStep = {
  from: 2,
  summary:
    "per-role run ceilings (roles[].launch.limits) — the schema widens, no data changes; the number moves alone",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
    ],
  }),
};
