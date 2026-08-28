/**
 * MIGRATION 20 → 21: the codex effort vocabulary is the vendor's LIVE list, not its
 * documentation — `minimal` leaves and `max` arrives (thread `026-codex-agent-kind`;
 * john's decision of 2026-08-28, delivered as `2026-08-28T17-38-51Z-curator.md`).
 *
 * WHY THIS ONE IS NOT LIKE 19 AND 20. Those two WIDENED the set of configs the package
 * accepts, so every config valid before them stayed valid and no step wrote anything. This
 * one moves in both directions at once, and the second direction is the one that costs:
 *
 *  - `max` is ADDED to the codex member. Additive, and invisible to the value guard on top
 *    of that — the OTHER member already contributed the row `roles[].launch.agent.effort =
 *    "max"`, and `CONFIG_VALUES` records the union of the members, not their split;
 *  - `minimal` is REMOVED. That is a narrowing, and a narrowing is the case the guard's own
 *    repair text calls a REWRITE rather than a bump: the config already on disk is the one
 *    that stops being readable. A card at version 20 naming `effort: "minimal"` meets THIS
 *    build with an invalid-enum refusal, and no number alone repairs that — the value has
 *    to be changed on disk, which is what this step does.
 *
 * WHY `minimal` HAD TO GO — a measurement, not a preference. It entered the enum from the
 * vendor's config reference (`model_reasoning_effort`), read by a session with no network
 * and declared weak provenance on the spot. The box has since run the tool: the vendor's
 * live list (`/home/lle/.codex/models_cache.json`, `client_version 0.150.1`, `fetched_at
 * 2026-08-28T17:46:24Z`) carries `low medium high xhigh` on every model, `max` on four of
 * six, `ultra` on one — and `minimal` on NONE. The one card that named it (`pilot-codex`)
 * had already died at the vendor for the neighbouring reason, on the model rather than the
 * level (`400: The 'gpt-5-codex' model is not supported when using Codex with a ChatGPT
 * account`, run of 2026-08-28T17:29:38Z). So the enum was not guarding the run: it was
 * admitting a word that buys a spent lease and a dead session.
 *
 * WHY THE STEP REWRITES `minimal` → `low` INSTEAD OF REFUSING. A refusal is the honest
 * answer when a step cannot know what the project meant; here it can. There is no level
 * BELOW `low` on the live list, so `low` is the only reading of `minimal` that both exists
 * and preserves the intent (the cheapest run the tool sells). The alternative — halting the
 * chain and asking a human — would stop a repository from reaching a readable version over
 * a value that is provably dead. The rewrite is named in the plan's notes, and the dry run
 * shows the file before anything is written, which is where a project that meant something
 * else gets to say so.
 *
 * WHAT THE STEP DOES NOT TOUCH. `launch.agent.model` — the same card's other broken value
 * (`gpt-5-codex`) is corrected by hand in the same PR and NOT here: which model a project
 * pays for is its decision, the vendor's catalogue changes without us, and a step that
 * picked a model would be spending another repository's money to make its config parse.
 * The `claude-code` member is untouched: its vocabulary never had `minimal`.
 */
import type { MigrationContext, MigrationEffect, MigrationStep } from "./step.js";

/** The value that leaves the vocabulary, and the one every card carrying it becomes. */
export const CODEX_EFFORT_RETIRED = "minimal";
export const CODEX_EFFORT_REPLACEMENT = "low";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The rewrite, as a pure function of the raw config so the step can both APPLY it and
 * COUNT it for the notes. Anything that is not the exact shape being repaired is passed
 * through untouched: a migration is not a validator, and a config too broken to read here
 * is a config the schema refuses by name a moment later.
 */
export const retireCodexMinimalEffort = (
  config: Record<string, unknown>,
): { readonly config: Record<string, unknown>; readonly roles: readonly string[] } => {
  const roles = config.roles;
  if (!Array.isArray(roles)) return { config, roles: [] };

  const touched: string[] = [];
  const rewritten = roles.map((role) => {
    if (!isRecord(role)) return role;
    const launch = role.launch;
    if (!isRecord(launch)) return role;
    const agent = launch.agent;
    if (!isRecord(agent)) return role;
    if (agent.kind !== "codex" || agent.effort !== CODEX_EFFORT_RETIRED) return role;

    touched.push(typeof role.id === "string" ? role.id : "(role without an id)");
    return {
      ...role,
      launch: { ...launch, agent: { ...agent, effort: CODEX_EFFORT_REPLACEMENT } },
    };
  });

  if (touched.length === 0) return { config, roles: [] };
  return { config: { ...config, roles: rewritten }, roles: touched };
};

export const CODEX_EFFORT_VOCABULARY_STEP: MigrationStep = {
  from: 20,
  summary:
    "the codex effort vocabulary follows the vendor's live list: 'max' is admitted, 'minimal' is retired (no model sells it), and every codex card naming 'minimal' is rewritten to 'low' — a narrowing, so the config on disk changes and not only the number",
  plan: (context: MigrationContext): MigrationEffect => {
    const { config, roles } = retireCodexMinimalEffort(context.config);
    const rewrite =
      roles.length === 0
        ? "no card names 'minimal': nothing but protocolVersion changes here, and the number still matters — an older build meets 'effort: \"max\"' on a codex card as an invalid enum value instead of 'restart required'"
        : `effort 'minimal' → 'low' on ${roles.length === 1 ? "the codex card" : "the codex cards"} ${roles.join(", ")}: the vendor sells no level below 'low', so this is the cheapest run that EXISTS — review the rendered config before '--write' if the project meant otherwise`;

    return {
      config: roles.length === 0 ? undefined : config,
      notes: [
        rewrite,
        "this is the FIRST step that narrows the accepted values: a config at 20 carrying 'minimal' is refused by this build with an invalid enum value, so the repair is a rewrite of the file and not a bump of the number alone",
        "the source is the vendor's live list, not its documentation (/home/lle/.codex/models_cache.json, codex-cli 0.150.1, fetched 2026-08-28T17:46:24Z): every model carries low/medium/high/xhigh, four of six carry 'max', one carries 'ultra', none carries 'minimal'",
        "'ultra' is NOT admitted: one model of six carries it and no card names that model — the refusal it costs prints the list, and widening a closed enum on speculation is what the enum exists against",
        "'launch.agent.model' is NOT touched by this step: a dead model value is corrected by whoever pays for the replacement, and the catalogue changes without us",
        "the claude-code member is untouched — its vocabulary never had 'minimal', and 'max' has been in it since version 4",
        "the mail is not touched: this version says nothing about message headers",
      ],
    };
  },
};
