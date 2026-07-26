/**
 * MIGRATION 7 → 8: the graceful deadline (R20, thread `016-protocol-roadmap`).
 *
 * Version 8 widens ONE shape and moves no data: the config gains
 * `roles[].launch.limits.windDownSeconds` — how long before its deadline a session of
 * this role is expected to stop digging and land its work. Optional, and its
 * fall-through is not a constant but a share of that role's resolved window
 * (`defaultWindDownSeconds`), so a role that says nothing gets a landing proportionate
 * to the runs it actually has.
 *
 * NOTHING IN THE JOURNAL AND NOTHING IN THE MAIL. The other two parts of R20 add no
 * shape at all: the deadline reaches the session through the ENVIRONMENT of its own
 * process (`AGENT_PROTOCOL_LEASE_DEADLINE`, which nothing persists) and through the
 * launch prompt (which nothing persists either). The wall clock keeps its old event
 * vocabulary on purpose — `timeout` does not become a new outcome, it changes MEANING:
 * from the routine ending of a long run to the record of a session that did not land.
 * A meaning is not a migration.
 *
 * WHY IT IS STILL A VERSION, for the sixth time: the config schema is strict, so a
 * build of the package that predates `windDownSeconds` REFUSES a config carrying it,
 * and without the number that refusal blames the config instead of naming the repair.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const GRACEFUL_DEADLINE_STEP: MigrationStep = {
  from: 7,
  summary:
    "the graceful deadline: the landing margin (roles[].launch.limits.windDownSeconds) — the schema widens, no data changes; the journal and the mail are untouched",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'windDownSeconds' is OPTIONAL — a role that says nothing gets 20% of its own wall clock (min 2 min, max 15 min); the flag --wind-down overrides both",
      "the journal is NOT rewritten and the mail is not touched: the deadline reaches a session through its environment and its prompt, neither of which is stored",
    ],
  }),
};
