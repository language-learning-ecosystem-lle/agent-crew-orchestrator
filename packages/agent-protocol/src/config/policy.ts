/**
 * THE POLICY HALF OF THE CONFIG — the few fields a door reads about SOMEBODY ELSE'S
 * ref (thread `037-zones-door-version-gate`, john's decision of 2026-07-31).
 *
 * WHY A SECOND SHAPE AT ALL. Two commands ask the config a question about a point in
 * history that is NOT their own world: `zones check` reads the BASE of a pull request
 * ("which paths does the base policy forbid this role"), `merge-gate` reads the base
 * too ("which documents are documents of power"). On a PR that changes the protocol's
 * own shape the base is, by construction, at another shape than the package reading it
 * — that is what such a PR IS. Parsing all of it strictly there makes both doors red on
 * exactly the class of change that touches the protocol's shape, and the refusal is a
 * lie twice over: the base config is valid at its own version, and it is the READER
 * that moved, not the data.
 *
 * The earlier answer to this was `tolerateOlder`, which relaxed only the NUMBER. It
 * closed a bump of the number (v13, #55) and could not close a bump of the FORM: an
 * added required field or a renamed one fails in `protocolConfigSchema.safeParse`,
 * BEFORE the version gate is ever reached. `tolerateOlder` is gone from the loader —
 * it was the special case of what is written here.
 *
 * THE GATE IS A PROPERTY OF THE QUESTION, NOT OF THE COMMAND (the fork john decided).
 * A reader of DATA — one that goes on to write a message header, an event, a derived
 * file — must be stopped when the shapes differ, because it would otherwise read or
 * write the wrong shape silently. A reader of POLICY touches no data at all: it asks
 * for `roles[].id`, `roles[].zones`, `roles[].instructions[].path` and
 * `orchestrator.workdir.worktrees`, and none of those means anything different at
 * another version.
 *
 * WHAT THIS SHAPE PROMISES, AND WHAT IT DOES NOT. Every field here is built from the
 * SAME field schemas as the full config (`roleSchema.pick`, `zonesSchema`,
 * `instructionsSchema`) — a hand-written copy would drift from the original, and the
 * drift would be invisible until a door judged by a stale rule. What is relaxed is
 * only the STRICTNESS of the objects on the way: an unknown key of another version is
 * passed through instead of refused. What is NOT promised (curator's caveat, msg-003
 * §3, accepted by john): if a future version moves `zones.forbidden`, `roles[].id` or
 * `orchestrator.workdir` themselves, this shape will not find them and the door will
 * refuse — honestly, by the DATA rather than by the number, but refuse. Such a move is
 * a manual event, and it is meant to be.
 */
import { z } from "zod";

import { instructionsSchema, roleSchema, zonesSchema } from "../roles/schema.js";
import type { VersionVerdict } from "../schema/version.js";

/** Zones, loose: the door reads `forbidden`, a key added beside it is not its business. */
const policyZonesSchema = zonesSchema.loose();

/** One instruction document, loose: only `path` is read (the documents of power). */
const policyInstructionsSchema = instructionsSchema.loose();

/**
 * A role AS A DOOR SEES IT: an id, the zones it may not write, the documents it points
 * at. `id` comes from `roleSchema` itself rather than from a copy of the regex — the id
 * is the token that also appears in `waiting-on`, and two definitions of it would be
 * two definitions of who a role is.
 */
export const policyRoleSchema = roleSchema
  .pick({ id: true })
  .extend({
    zones: policyZonesSchema.optional(),
    instructions: z.array(policyInstructionsSchema).min(1).optional(),
  })
  .loose();

/**
 * The config as a door sees it. `protocolVersion` is kept REQUIRED, and it is the one
 * field here that is not read for a verdict: it is read to be SAID OUT LOUD. A door
 * that quietly judged by a config of another shape would be the stale-config defect
 * this package exists against, so the skew is always printed (`describePolicySkew`).
 */
export const policyConfigSchema = z.looseObject({
  protocolVersion: z.number().int().min(1),
  /**
   * The documents of power the served project DECLARES (v18). It is listed here and not
   * merely tolerated by the loose object for one reason: a field only the strict schema
   * knows about is a field the DOOR never sees — `merge-gate` reads the base through this
   * shape, so guard 4 would keep judging by yesterday's list while every unit test on the
   * strict schema stayed green. Optional and loosely typed for the same reason as the rest
   * of this file: a base at another version may not have the key at all.
   */
  powerDocuments: z.array(z.string().min(1)).optional(),
  roles: z.array(policyRoleSchema).min(1),
  orchestrator: z
    .looseObject({
      workdir: z.looseObject({ worktrees: z.string().min(1).optional() }).optional(),
    })
    .optional(),
});

export type PolicyRole = z.infer<typeof policyRoleSchema>;
export type PolicyConfig = z.infer<typeof policyConfigSchema>;

/** The role by id, for a door that has no registry — the registry is built from DATA. */
export const policyRole = (config: PolicyConfig, id: string): PolicyRole | undefined =>
  config.roles.find((role) => role.id === id);

/**
 * The sentence a door prints when the shapes differ. ONE wording for both doors: the
 * skew is the same fact, and two phrasings of it would be read as two facts.
 *
 * Both directions are said, and neither is fatal here — `behind` is what a version bump
 * looks like from its own PR, `ahead` is what the base looks like to a branch that has
 * not rebased. Silence in either direction is what is refused.
 */
export const describePolicySkew = (input: {
  readonly ref: string;
  readonly version: VersionVerdict;
}): string | undefined => {
  if (input.version.state === "current") return undefined;
  return `'${input.ref}' declares protocol version ${input.version.declared}, this package writes ${input.version.supported}; only the policy fields are read from it (roles, zones, instruction paths, workdir), so the rest of its shape does not matter here`;
};
