/**
 * MIGRATION 18 → 19: a card may name `codex` as the tool that raises the role (thread
 * `026-codex-agent-kind`).
 *
 * WHAT WIDENED. `roles[].launch.agent` was a union with a single member — `kind:
 * "claude-code"` — so `launch.agent.kind: "codex"` was refused by the SCHEMA even after the
 * package learned to raise codex (#71: argv, stream, probe, repair, `cannot`). The second
 * member (`kind: "codex"`, `model`) is what this version admits.
 *
 * WHY IT IS A VERSION THOUGH NO KEY APPEARS — and this is the difference from v15…v18, which
 * every added a key. What an older build does with a config it cannot represent is the same
 * either way: `roles[].launch.agent` is a strict discriminated union, so a build from before
 * this version meets `kind: "codex"` with an invalid-discriminator refusal — accurate, true
 * and useless — and the ONE thing that turns it into "the config is newer than this build,
 * restart what is running on it" is the number. The incident of 2026-07-31 (a live daemon
 * died on `Unrecognized key` at an equal version, two sessions with it) is the same failure
 * with a key instead of a value.
 *
 * AND THE GUARD DOES NOT SEE THIS ONE. `schema/shape.ts` freezes the set of KEY PATHS the
 * config accepts; `roles[].launch.agent.kind` and `.model` have stood in that table since
 * version 14, so a second union member with the same field names leaves the table unchanged
 * and the guard silent. It is recorded here rather than left to be re-derived: the ceremony
 * R2 asks for was performed by hand this time, and the blind spot in the guard is a finding
 * of its own (reviewer-pr on #74) that belongs to the guard, not to this step.
 *
 * NOTHING IS WRITTEN BY THE STEP. Every config valid at 18 is valid at 19 — the change is
 * purely additive, no role names codex until somebody edits a card, and a step that put the
 * kind into a card would be choosing another repository's executor for it.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const CODEX_KIND_STEP: MigrationStep = {
  from: 18,
  summary:
    "the card may name codex: 'roles[].launch.agent' admits a second member (kind 'codex' with an optional 'model') beside 'claude-code' — the schema stops refusing a tool the package implements; no key appears and no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "no role is moved onto codex by this step — which tool raises a role is a decision of the project, and every config valid at 18 stays valid at 19 unchanged",
      "the number exists for the OLDER build: 'launch.agent' is a strict discriminated union, so a build from before this version answers a card naming codex with an invalid-discriminator refusal instead of 'restart required'",
      "the shape guard (schema/shape.ts) cannot catch this one: it freezes KEY PATHS, and 'roles[].launch.agent.kind'/'.model' have been in the table since version 14 — a widened set of VALUES leaves it unchanged",
      "the mail is not touched: this version says nothing about message headers",
    ],
  }),
};
