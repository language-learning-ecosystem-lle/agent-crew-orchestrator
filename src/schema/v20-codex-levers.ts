/**
 * MIGRATION 19 → 20: a card raised on codex may say what holds it instead of an
 * allow-list, and may name codex's own effort levels (thread `026-codex-agent-kind`,
 * П1 and П2 of the statement of work; john's decision of 2026-08-24).
 *
 * WHAT WIDENED — two things, and they travel together because they are one config edit
 * for whoever writes the pilot's card:
 *
 *  1. `roles[].launch.agent` (member `codex`) gained `toolsHeldBy: "sandbox-read-only"`,
 *     and with it `roles[].launch.allowedTools` became CONDITIONALLY optional. Codex has
 *     no `--allowedTools` and no settings-borne zone denial, so a role raised on it is
 *     confined by the vendor's read-only sandbox and by CI; the field is where that is
 *     DECLARED. Where the field is absent the old refusal stands unchanged — a role
 *     asking for a lever its tool lacks is still refused by name, and a role on
 *     claude-code without `allowedTools` is still refused by the schema;
 *  2. `roles[].launch.agent.effort` on the `codex` member accepts codex's vocabulary —
 *     one value that the other tool does not have (`minimal`), and without the one codex
 *     does not have (`max`).
 *
 * WHY IT IS A VERSION. Both halves widen the set of configs the package accepts, which is
 * the same event as adding a key for an older build reading a newer file: a build from
 * before this version meets `toolsHeldBy` with `Unrecognized key` and `effort: "minimal"`
 * with an invalid enum value — accurate, true and useless — and the number is the one
 * thing that turns either into "the config is newer than this build, restart what is
 * running on it". The incident of 2026-07-31 (a live daemon died on `Unrecognized key` at
 * an equal version, two sessions with it) is the same failure with another key.
 *
 * AND THIS TIME BOTH HALVES OF THE GUARD SEE IT: `toolsHeldBy` is a new key path
 * (`CONFIG_SHAPES[20]`) and `minimal` a new pinned value (`CONFIG_VALUES[20]`) — unlike
 * v19, which the shape half could not see at all.
 *
 * NOTHING IS WRITTEN BY THE STEP. Every config valid at 19 is valid at 20: both fields are
 * optional, neither has a default, and NO ROLE IS MOVED ONTO CODEX by this step. Which
 * tool raises a role, and whether a role's levers may be waived, are decisions of the
 * project — a step that wrote either into a card would be making them for it.
 */
import type { MigrationEffect, MigrationStep } from "./step.js";

export const CODEX_LEVERS_STEP: MigrationStep = {
  from: 19,
  summary:
    "the pilot's card may say what holds it: 'roles[].launch.agent' (codex) admits 'toolsHeldBy: \"sandbox-read-only\"' — which makes 'launch.allowedTools' optional for a tool with no such lever — and 'effort' with codex's own levels (minimal…xhigh); no data changes",
  plan: (): MigrationEffect => ({
    notes: [
      "nothing but protocolVersion changes: edit the number in the config by hand and discard the rendered file (the runner reflows JSON)",
      "no role is moved onto codex and no role loses its allow-list by this step: both fields are optional, neither has a default, and a waiver by silence is exactly what the decision ruled out",
      "the number exists for the OLDER build: it meets 'toolsHeldBy' as an unrecognized key and 'effort: \"minimal\"' as an invalid enum value instead of 'restart required'",
      "'launch.allowedTools' stays REQUIRED wherever the tool has the lever — a role on claude-code without it is refused by the schema, by name, exactly as before",
      "the mail is not touched: this version says nothing about message headers",
    ],
  }),
};
