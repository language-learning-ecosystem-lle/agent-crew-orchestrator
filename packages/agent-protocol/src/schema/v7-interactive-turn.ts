/**
 * MIGRATION 6 → 7: the interactive turn (R19, thread `016-protocol-roadmap`).
 *
 * Version 7 widens two shapes and moves no data:
 *  - the config gains `roles[].launch.limits.waitInputSeconds` — the ceiling of a
 *    declared wait for input. Optional: a role that says nothing gets the package
 *    default (one hour);
 *  - the journal gains two event kinds (`input-awaited`, `input-received`) and two
 *    release reasons (`input-timeout`, `exited-while-waiting`) — the states a parked
 *    run passes through.
 *
 * WHY THE JOURNAL IS NOT REWRITTEN, for the second time and for the same reason as
 * 5 → 6: the additions describe runs that had not happened yet. A journal written
 * before this version simply has no parked runs in it, and every line in it parses
 * unchanged — an old shape read by the new package, which is the direction that always
 * works here.
 *
 * WHY IT IS STILL A VERSION, for the fifth time: the config schema is strict, so a
 * build of the package that predates `waitInputSeconds` REFUSES a config carrying it.
 * Without the number that refusal reads "unrecognized key: waitInputSeconds" and blames
 * the config; with it, "the repository declares 7, the package supports 6 — update the
 * package", which names the repair.
 *
 * WHAT IS DELIBERATELY NOT IN THIS VERSION: the message header. A parked session's
 * aliveness is a fact about the RUN and lives in the run's own state directory
 * (`orchestrator/interactive.ts` says why at length) — so the shape of the mail, the
 * assembled `_thread.md` and the INDEX are untouched by R19, and no thread needs
 * migrating.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const INTERACTIVE_TURN_STEP: MigrationStep = {
  from: 6,
  summary:
    "the interactive turn: the wait ceiling (roles[].launch.limits.waitInputSeconds) and the parked-run events of the journal — the schema widens, no data changes; the number moves alone",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'waitInputSeconds' is OPTIONAL — a role that says nothing gets the package default (3600s); the flag --wait-input overrides both",
      "the journal is NOT rewritten and the mail is not touched at all: R19 adds no field to a message header, so no thread needs migrating",
    ],
  }),
};
