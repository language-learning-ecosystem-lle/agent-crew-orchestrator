/**
 * MIGRATION 3 → 4: which tool raises a role, and with which parameters (R15, thread
 * `016-protocol-roadmap`).
 *
 * Version 4 adds one optional field — `roles[].launch.agent` (`kind`, and for
 * `claude-code` also `model` and `effort`). Like 2 → 3 before it, it MOVES NO DATA: a
 * version-3 config is already a valid version-4 one, and not one message, thread or
 * journal line is touched. The step carries the number and nothing else.
 *
 * WHY IT IS STILL A VERSION — the same argument as for 3, and it is worth having it
 * written twice rather than assumed once: the schemas are strict on purpose, so a
 * build of the package that predates this field REFUSES a config that carries it.
 * Without the number that refusal reads "unrecognized key: agent" and blames the
 * config; with it, it reads "the repository declares 4, the package supports 3 —
 * update the package", which names the repair.
 *
 * WHAT IS NOT VERSIONED, AND DELIBERATELY: the MACHINE config that arrived with it
 * (R14, `config/local.ts`). `protocolVersion` covers the shape of data that TRAVELS —
 * the config, threads, message headers, the journal — where two parties can disagree
 * about what they are reading. The machine file travels nowhere: one box, one writer,
 * a human, outside git. What is left of the version's job there is the diagnosis, and
 * a strict schema gives that directly by naming the field it does not know.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const AGENT_PARAMS_STEP: MigrationStep = {
  from: 3,
  summary:
    "per-role launch agent (roles[].launch.agent: kind/model/effort) — the schema widens, no data changes; the number moves alone",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
    ],
  }),
};
