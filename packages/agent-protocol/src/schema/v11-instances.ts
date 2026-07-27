/**
 * MIGRATION 10 → 11: the boxes that raise roles (R13, thread `016-protocol-roadmap`).
 *
 * Version 11 widens ONE shape and moves no data: the config gains an optional
 * `instances` section — the topology, open in the repository, that says which machine
 * raises which role. The machine's half of the join (`instance` in
 * `~/.config/agent-protocol/local.json`) is NOT versioned by this number and cannot be:
 * that file travels nowhere, has one writer and is outside every migration mechanism
 * there is — the same reasoning as R14.
 *
 * NOTHING IS REWRITTEN. A repository that declares no instances behaves exactly as it
 * did before: one box, every role, no filtering. The section becomes load-bearing only
 * once a project writes it, and from that moment `config check` demands that every
 * launchable role be claimed by exactly one instance — a role with no owner or with two
 * is refused, because that is precisely the configuration in which two machines raise
 * one role and their local leases protect neither.
 *
 * WHY IT IS A VERSION, for the ninth time: the config schema is strict, so a build of
 * the package that predates the section REFUSES a config carrying it. The number turns
 * that refusal from "your config is broken" into "update the package".
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const INSTANCES_STEP: MigrationStep = {
  from: 10,
  summary:
    "the boxes that raise roles: the optional config section 'instances' (id, roles, note) — the schema widens, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "'instances' is OPTIONAL: leave it out and the circuit behaves exactly as before (one box, every role). Write it and every launchable role must be claimed by exactly one instance — 'config check' refuses a role with none or with two",
      'each box also says WHICH instance it is, in the machine config (~/.config/agent-protocol/local.json, "instance": "<id>") — that file is not versioned by this number and is delivered by hand, once per machine',
      "the mail is NOT rewritten: nothing about a thread or a message changes",
    ],
  }),
};
