/**
 * MIGRATION 11 → 12: the role hosted by a live process (R23-1, thread
 * `016-protocol-roadmap`).
 *
 * Version 12 widens ONE enum and moves no data: `wake.mode` gains `resident` — a role
 * that nothing brings the turn to, because its process never left the feed. Every
 * existing row keeps its mode and its behaviour; a repository that names no resident is
 * the pre-R23 circuit verbatim.
 *
 * IT IS A CAPABILITY, NOT A FLIP, and the step says so because that ordering is the
 * decision (curator, 2026-07-27): a role turned resident stops being raised at that
 * moment, and if the process meant to replace the raised session does not exist yet, the
 * role has no executor at all. So the mode ships first and is proven on a hypothetical
 * row; the row of a real role is moved last, in a PR of one line whose rollback is the
 * same line back.
 *
 * WHAT CHANGING A ROW COSTS, for whoever runs this later: `wake: resident` takes the
 * role out of the launchable set (`roleLaunchability` refuses it with the reason
 * `resident`), out of `watchTargets` and out of `notificationTargets` — and leaves it
 * INSIDE ownership: `config check` keeps demanding that an instance claim it, now as the
 * box that HOSTS it. A thread waiting on it is spoken by the daemon every tick and shown
 * by `status`, because a resident that dies fails silently and visibility is the only
 * honest answer to that (a heartbeat is refused in `hold.ts`).
 *
 * WHY IT IS A VERSION, for the tenth time: the config schema is strict, so a build of
 * the package that predates the mode REFUSES a config carrying it. The number turns that
 * refusal from "your config is broken" into "update the package".
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const RESIDENT_WAKE_STEP: MigrationStep = {
  from: 11,
  summary:
    "the role hosted by a live process: 'wake.mode' gains 'resident' — the enum widens, no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "no role becomes resident by migrating: the mode is a CAPABILITY, and moving a real role onto it is a separate one-line change — do it only when the process that hosts the role exists, otherwise the role has no executor between the two",
      "a resident role is not raised, not woken and not notified, and is STILL owned: 'config check' demands an instance claim it — as the box that hosts it (R13)",
      "the mail is NOT rewritten: nothing about a thread or a message changes",
    ],
  }),
};
