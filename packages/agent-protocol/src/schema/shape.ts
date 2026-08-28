/**
 * THE SHAPE OF THE CONFIG, FROZEN PER VERSION — the door that makes "a new field is a new
 * version" (R2) a check instead of a habit.
 *
 * Paid for by an incident (curator, 2026-07-31, thread `023-daemon-parallelism`): the merge of
 * #127 added `notifications.templates.parked` to the config and did NOT bump `protocolVersion`.
 * The live daemon — a build from before that merge — met an unknown key at an EQUAL version and
 * died on `role config is invalid: Unrecognized key`, taking two live sessions with it. Every
 * part of the machinery for that case already existed and every part was right: the strict
 * object is right to refuse a key it does not know, and the ahead-gate is right to say "restart
 * required" instead — but only when the number says the config is newer. With the number left
 * behind, the honest diagnosis was unreachable, and the one thing missing was anybody noticing
 * the field went in without it.
 *
 * So the check is on the SHAPE, not on the diff: "was a zod object edited" is a question about
 * a patch, and a patch can add a field through a helper, a spread or a schema in another file.
 * The set of key paths the config accepts is the fact that actually changed, it is computable
 * from the schema itself, and it is frozen here per version. Add a field and this table no
 * longer describes the schema — the test is red until the version is bumped and the new shape
 * recorded against the NEW number, which is exactly the ceremony R2 asks for and the one the
 * incident skipped.
 *
 * The entries of released versions are HISTORY: they are appended to, never edited. Rewriting
 * one would be the same defect wearing a green test.
 *
 * THE GUARD HAS TWO HALVES, AND THE SECOND ONE WAS PAID FOR TOO (curator, thread
 * `034-shape-guard-values-blind`). The half above freezes the set of key PATHS; it says nothing
 * about the set of VALUES a frozen path accepts, and the walker below is why: members of a union
 * are walked into the SAME path, so a second member carrying the same field names adds not one
 * row to the table. Measured on PR #74 (thread `026`): `roles[].launch.agent.kind` has stood in
 * the table since version 14 with `claude-code` as its only value, the PR added `codex` beside
 * it, the set of ACCEPTED CONFIGS grew and the table did not move. An older build at an equal
 * number would have met a card saying `kind: "codex"` as an invalid discriminator instead of
 * "restart required" — the same class, to the byte, as the daemon of 2026-07-31. The bump that
 * PR carries was put there by a human reviewer's eye, not by this door; so the door gained
 * `CONFIG_VALUES`, which freezes the `enum`/`const` nodes of the SAME projection, keyed by the
 * SAME path.
 */
import { z } from "zod";

import { protocolConfigSchema } from "../config/config.js";
import { CURRENT_PROTOCOL_VERSION } from "./version.js";

/**
 * The one walk over the JSON-Schema projection, shared by both halves of the guard.
 *
 * Derived from the schema through its projection rather than from zod's internals: the
 * projection is a public contract of the library, and a walker over `_def` would be a second
 * thing to fix on every zod upgrade — in a guard whose whole value is that it does not quietly
 * stop working. For the same reason there is ONE walker and not two: two would be two things to
 * fix, and the half that got missed would be the half that goes quiet.
 */
const walkProjection = (
  schema: z.ZodType,
  visit: (node: Record<string, unknown>, at: string) => void,
): void => {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  const walk = (node: unknown, at: string): void => {
    if (node === null || typeof node !== "object") return;
    const shape = node as Record<string, unknown>;
    visit(shape, at);
    for (const [key, value] of Object.entries(
      (shape.properties as Record<string, unknown>) ?? {},
    )) {
      walk(value, at === "" ? key : `${at}.${key}`);
    }
    // An array's items and a record's values are one step DOWN and nameless — `[]` says so, so
    // that `roles[].id` reads as the field of a role rather than of the list.
    for (const branch of ["items", "additionalProperties", "propertyNames"]) {
      if (shape[branch] !== undefined) walk(shape[branch], `${at}[]`);
    }
    for (const list of ["anyOf", "oneOf", "allOf"]) {
      for (const member of (shape[list] as unknown[]) ?? []) walk(member, at);
    }
    for (const def of Object.values((shape.$defs as Record<string, unknown>) ?? {})) {
      walk(def, at);
    }
  };
  walk(json, "");
};

/**
 * Every key path the config schema accepts, sorted — `a.b`, and `a[].b` for the members of an
 * array or of a record's values.
 *
 * The argument exists for the guard's own tests, which have to hold a schema OTHER than the live
 * one to show what the walker does and does not see; every caller in the package asks about the
 * config.
 */
export const configShapeKeys = (schema: z.ZodType = protocolConfigSchema): readonly string[] => {
  const keys = new Set<string>();
  walkProjection(schema, (node, at) => {
    for (const key of Object.keys((node.properties as Record<string, unknown>) ?? {})) {
      keys.add(at === "" ? key : `${at}.${key}`);
    }
  });
  return [...keys].sort();
};

/**
 * Every VALUE the config schema pins, sorted — one row per pair, `<path> = <json>`, where the
 * path is the one `configShapeKeys` would give and the value is the literal spelled as it is
 * written in the file.
 *
 * `enum` and `const` are the two forms zod's projection gives a pinned value (`z.enum`,
 * `z.literal`, and the discriminator of a discriminated union). One row per PAIR rather than one
 * row per path with a list: a diff of two sorted flat lists names the value that moved, and
 * naming it is the whole point — "the array at `roles[].status` changed" is the refusal that
 * sends a reader back to the schema to find out what actually happened.
 *
 * WHAT THIS DELIBERATELY DOES NOT SEE: values enforced by code rather than by type — the
 * `superRefine` vocabularies (`notifications.templates.*` is checked against the variables its
 * slot allows) and every domain a `refine` computes. They are not in the projection, and a table
 * that pretended to guard them would be worse than one that says it does not.
 */
export const configShapeValues = (schema: z.ZodType = protocolConfigSchema): readonly string[] => {
  const values = new Set<string>();
  walkProjection(schema, (node, at) => {
    for (const value of (node.enum as unknown[]) ?? []) {
      values.add(`${at} = ${JSON.stringify(value)}`);
    }
    if ("const" in node) values.add(`${at} = ${JSON.stringify(node.const)}`);
  });
  return [...values].sort();
};

/**
 * The shape of the config AS OF each protocol version. Append-only: a new version adds an
 * entry, the entries already here are the record of what was released.
 *
 * The table starts at 14 — the version in force when the guard was written. It does not
 * re-version what went in before it: an entry for 13 would be a claim about a build nobody
 * can check any more, and the guard's job starts with the next field, not with the last one.
 */
export const CONFIG_SHAPES: Readonly<Record<number, readonly string[]>> = {
  14: [
    "announcements",
    "announcements.force-stop",
    "instances",
    "instances[].id",
    "instances[].note",
    "instances[].roles",
    "mail",
    "mail.branch",
    "mail.dir",
    "notifications",
    "notifications.stalledAfterMinutes",
    "notifications.templates",
    "notifications.templates.nudge",
    "notifications.templates.parked",
    "notifications.templates.stalled",
    "notifications.templates.turn",
    "notifications.templates.turn-with-nudge",
    "notifications.transport",
    "notifications.transport.module",
    "notifications.transport.options",
    "orchestrator",
    "orchestrator.env",
    "orchestrator.mailCheckout",
    "orchestrator.ref",
    "orchestrator.state",
    "orchestrator.workdir",
    "orchestrator.workdir.branch",
    "orchestrator.workdir.worktrees",
    "protocolVersion",
    "roles",
    "roles[].id",
    "roles[].instructions",
    "roles[].instructions[].kind",
    "roles[].instructions[].note",
    "roles[].instructions[].path",
    "roles[].kind",
    "roles[].launch",
    "roles[].launch.agent",
    "roles[].launch.agent.effort",
    "roles[].launch.agent.kind",
    "roles[].launch.agent.model",
    "roles[].launch.allowedTools",
    "roles[].launch.limits",
    "roles[].launch.limits.idleSeconds",
    "roles[].launch.limits.maxTurns",
    "roles[].launch.limits.waitInputSeconds",
    "roles[].launch.limits.wallClockSeconds",
    "roles[].launch.limits.windDownSeconds",
    "roles[].permissions",
    "roles[].status",
    "roles[].summary",
    "roles[].wake",
    "roles[].wake.mode",
    "roles[].wake.session",
    "roles[].wake.via",
    "roles[].zones",
    "roles[].zones.forbidden",
    "roles[].zones.writes",
  ],
  15: [
    "announcements",
    "announcements.force-stop",
    "instances",
    "instances[].id",
    "instances[].note",
    "instances[].roles",
    "mail",
    "mail.branch",
    "mail.dir",
    "notifications",
    "notifications.stalledAfterMinutes",
    "notifications.templates",
    "notifications.templates.nudge",
    "notifications.templates.parked",
    "notifications.templates.stalled",
    "notifications.templates.turn",
    "notifications.templates.turn-with-nudge",
    "notifications.transport",
    "notifications.transport.module",
    "notifications.transport.options",
    "orchestrator",
    "orchestrator.env",
    "orchestrator.mailCheckout",
    "orchestrator.ref",
    "orchestrator.state",
    "orchestrator.workdir",
    "orchestrator.workdir.branch",
    "orchestrator.workdir.worktrees",
    "protocolVersion",
    "roles",
    "roles[].id",
    "roles[].instructions",
    "roles[].instructions[].kind",
    "roles[].instructions[].note",
    "roles[].instructions[].path",
    "roles[].kind",
    "roles[].launch",
    "roles[].launch.account",
    "roles[].launch.agent",
    "roles[].launch.agent.effort",
    "roles[].launch.agent.kind",
    "roles[].launch.agent.model",
    "roles[].launch.allowedTools",
    "roles[].launch.limits",
    "roles[].launch.limits.idleSeconds",
    "roles[].launch.limits.maxTurns",
    "roles[].launch.limits.waitInputSeconds",
    "roles[].launch.limits.wallClockSeconds",
    "roles[].launch.limits.windDownSeconds",
    "roles[].permissions",
    "roles[].status",
    "roles[].summary",
    "roles[].wake",
    "roles[].wake.mode",
    "roles[].wake.session",
    "roles[].wake.via",
    "roles[].zones",
    "roles[].zones.forbidden",
    "roles[].zones.writes",
  ],
  16: [
    "announcements",
    "announcements.force-stop",
    "instances",
    "instances[].account",
    "instances[].id",
    "instances[].note",
    "instances[].roles",
    "mail",
    "mail.branch",
    "mail.dir",
    "notifications",
    "notifications.stalledAfterMinutes",
    "notifications.templates",
    "notifications.templates.nudge",
    "notifications.templates.parked",
    "notifications.templates.stalled",
    "notifications.templates.turn",
    "notifications.templates.turn-with-nudge",
    "notifications.transport",
    "notifications.transport.module",
    "notifications.transport.options",
    "orchestrator",
    "orchestrator.env",
    "orchestrator.mailCheckout",
    "orchestrator.ref",
    "orchestrator.state",
    "orchestrator.workdir",
    "orchestrator.workdir.branch",
    "orchestrator.workdir.worktrees",
    "protocolVersion",
    "roles",
    "roles[].id",
    "roles[].instructions",
    "roles[].instructions[].kind",
    "roles[].instructions[].note",
    "roles[].instructions[].path",
    "roles[].kind",
    "roles[].launch",
    "roles[].launch.account",
    "roles[].launch.agent",
    "roles[].launch.agent.effort",
    "roles[].launch.agent.kind",
    "roles[].launch.agent.model",
    "roles[].launch.allowedTools",
    "roles[].launch.limits",
    "roles[].launch.limits.idleSeconds",
    "roles[].launch.limits.maxTurns",
    "roles[].launch.limits.waitInputSeconds",
    "roles[].launch.limits.wallClockSeconds",
    "roles[].launch.limits.windDownSeconds",
    "roles[].permissions",
    "roles[].status",
    "roles[].summary",
    "roles[].wake",
    "roles[].wake.mode",
    "roles[].wake.session",
    "roles[].wake.via",
    "roles[].zones",
    "roles[].zones.forbidden",
    "roles[].zones.writes",
  ],
  17: [
    "announcements",
    "announcements.force-stop",
    "identityDictionary",
    "instances",
    "instances[].account",
    "instances[].id",
    "instances[].note",
    "instances[].roles",
    "mail",
    "mail.branch",
    "mail.dir",
    "notifications",
    "notifications.stalledAfterMinutes",
    "notifications.templates",
    "notifications.templates.nudge",
    "notifications.templates.parked",
    "notifications.templates.stalled",
    "notifications.templates.turn",
    "notifications.templates.turn-with-nudge",
    "notifications.transport",
    "notifications.transport.module",
    "notifications.transport.options",
    "orchestrator",
    "orchestrator.env",
    "orchestrator.mailCheckout",
    "orchestrator.ref",
    "orchestrator.state",
    "orchestrator.workdir",
    "orchestrator.workdir.branch",
    "orchestrator.workdir.worktrees",
    "protocolVersion",
    "roles",
    "roles[].id",
    "roles[].instructions",
    "roles[].instructions[].kind",
    "roles[].instructions[].note",
    "roles[].instructions[].path",
    "roles[].kind",
    "roles[].launch",
    "roles[].launch.account",
    "roles[].launch.agent",
    "roles[].launch.agent.effort",
    "roles[].launch.agent.kind",
    "roles[].launch.agent.model",
    "roles[].launch.allowedTools",
    "roles[].launch.limits",
    "roles[].launch.limits.idleSeconds",
    "roles[].launch.limits.maxTurns",
    "roles[].launch.limits.waitInputSeconds",
    "roles[].launch.limits.wallClockSeconds",
    "roles[].launch.limits.windDownSeconds",
    "roles[].permissions",
    "roles[].status",
    "roles[].summary",
    "roles[].wake",
    "roles[].wake.mode",
    "roles[].wake.session",
    "roles[].wake.via",
    "roles[].zones",
    "roles[].zones.forbidden",
    "roles[].zones.writes",
  ],
  18: [
    "announcements",
    "announcements.force-stop",
    "identityDictionary",
    "instances",
    "instances[].account",
    "instances[].id",
    "instances[].note",
    "instances[].roles",
    "mail",
    "mail.branch",
    "mail.dir",
    "notifications",
    "notifications.stalledAfterMinutes",
    "notifications.templates",
    "notifications.templates.nudge",
    "notifications.templates.parked",
    "notifications.templates.stalled",
    "notifications.templates.turn",
    "notifications.templates.turn-with-nudge",
    "notifications.transport",
    "notifications.transport.module",
    "notifications.transport.options",
    "orchestrator",
    "orchestrator.env",
    "orchestrator.mailCheckout",
    "orchestrator.ref",
    "orchestrator.state",
    "orchestrator.workdir",
    "orchestrator.workdir.branch",
    "orchestrator.workdir.worktrees",
    "powerDocuments",
    "protocolVersion",
    "roles",
    "roles[].id",
    "roles[].instructions",
    "roles[].instructions[].kind",
    "roles[].instructions[].note",
    "roles[].instructions[].path",
    "roles[].kind",
    "roles[].launch",
    "roles[].launch.account",
    "roles[].launch.agent",
    "roles[].launch.agent.effort",
    "roles[].launch.agent.kind",
    "roles[].launch.agent.model",
    "roles[].launch.allowedTools",
    "roles[].launch.limits",
    "roles[].launch.limits.idleSeconds",
    "roles[].launch.limits.maxTurns",
    "roles[].launch.limits.waitInputSeconds",
    "roles[].launch.limits.wallClockSeconds",
    "roles[].launch.limits.windDownSeconds",
    "roles[].permissions",
    "roles[].status",
    "roles[].summary",
    "roles[].wake",
    "roles[].wake.mode",
    "roles[].wake.session",
    "roles[].wake.via",
    "roles[].zones",
    "roles[].zones.forbidden",
    "roles[].zones.writes",
  ],
  /**
   * IDENTICAL TO 18 ON PURPOSE, and the equality is the record of what this guard cannot
   * see. Version 19 (thread `026`) widened `roles[].launch.agent` by a MEMBER — `kind:
   * "codex"` beside `claude-code` — and the member's field names (`kind`, `model`) have
   * stood in this table since 14, so the set of key paths did not move. An older build
   * still refuses such a config (a strict discriminated union), which is exactly the case
   * the number exists for; catching it is a job for a check on VALUES, which this one is
   * not (finding of reviewer-pr on #74, homed with the guard rather than with the step).
   */
  19: [
    "announcements",
    "announcements.force-stop",
    "identityDictionary",
    "instances",
    "instances[].account",
    "instances[].id",
    "instances[].note",
    "instances[].roles",
    "mail",
    "mail.branch",
    "mail.dir",
    "notifications",
    "notifications.stalledAfterMinutes",
    "notifications.templates",
    "notifications.templates.nudge",
    "notifications.templates.parked",
    "notifications.templates.stalled",
    "notifications.templates.turn",
    "notifications.templates.turn-with-nudge",
    "notifications.transport",
    "notifications.transport.module",
    "notifications.transport.options",
    "orchestrator",
    "orchestrator.env",
    "orchestrator.mailCheckout",
    "orchestrator.ref",
    "orchestrator.state",
    "orchestrator.workdir",
    "orchestrator.workdir.branch",
    "orchestrator.workdir.worktrees",
    "powerDocuments",
    "protocolVersion",
    "roles",
    "roles[].id",
    "roles[].instructions",
    "roles[].instructions[].kind",
    "roles[].instructions[].note",
    "roles[].instructions[].path",
    "roles[].kind",
    "roles[].launch",
    "roles[].launch.account",
    "roles[].launch.agent",
    "roles[].launch.agent.effort",
    "roles[].launch.agent.kind",
    "roles[].launch.agent.model",
    "roles[].launch.allowedTools",
    "roles[].launch.limits",
    "roles[].launch.limits.idleSeconds",
    "roles[].launch.limits.maxTurns",
    "roles[].launch.limits.waitInputSeconds",
    "roles[].launch.limits.wallClockSeconds",
    "roles[].launch.limits.windDownSeconds",
    "roles[].permissions",
    "roles[].status",
    "roles[].summary",
    "roles[].wake",
    "roles[].wake.mode",
    "roles[].wake.session",
    "roles[].wake.via",
    "roles[].zones",
    "roles[].zones.forbidden",
    "roles[].zones.writes",
  ],
  /**
   * 20 — thread `026`, П1: `roles[].launch.agent` (member `codex`) gained `toolsHeldBy`, the
   * field that says WHAT holds a session whose tool has no allow-list. One new key path, and
   * this time the half above sees it: unlike 19, whose whole change was a value.
   *
   * `roles[].launch.allowedTools` DID NOT LEAVE THE TABLE, and the absence of a change is the
   * point: the field went from required to conditionally optional, and this guard freezes the
   * set of paths a config may CARRY, not which of them it must. What the two halves of the door
   * cannot see is REQUIREDNESS — measured on this diff, reported to thread `034` rather than
   * worked around here.
   */
  20: [
    "announcements",
    "announcements.force-stop",
    "identityDictionary",
    "instances",
    "instances[].account",
    "instances[].id",
    "instances[].note",
    "instances[].roles",
    "mail",
    "mail.branch",
    "mail.dir",
    "notifications",
    "notifications.stalledAfterMinutes",
    "notifications.templates",
    "notifications.templates.nudge",
    "notifications.templates.parked",
    "notifications.templates.stalled",
    "notifications.templates.turn",
    "notifications.templates.turn-with-nudge",
    "notifications.transport",
    "notifications.transport.module",
    "notifications.transport.options",
    "orchestrator",
    "orchestrator.env",
    "orchestrator.mailCheckout",
    "orchestrator.ref",
    "orchestrator.state",
    "orchestrator.workdir",
    "orchestrator.workdir.branch",
    "orchestrator.workdir.worktrees",
    "powerDocuments",
    "protocolVersion",
    "roles",
    "roles[].id",
    "roles[].instructions",
    "roles[].instructions[].kind",
    "roles[].instructions[].note",
    "roles[].instructions[].path",
    "roles[].kind",
    "roles[].launch",
    "roles[].launch.account",
    "roles[].launch.agent",
    "roles[].launch.agent.effort",
    "roles[].launch.agent.kind",
    "roles[].launch.agent.model",
    "roles[].launch.agent.toolsHeldBy",
    "roles[].launch.allowedTools",
    "roles[].launch.limits",
    "roles[].launch.limits.idleSeconds",
    "roles[].launch.limits.maxTurns",
    "roles[].launch.limits.waitInputSeconds",
    "roles[].launch.limits.wallClockSeconds",
    "roles[].launch.limits.windDownSeconds",
    "roles[].permissions",
    "roles[].status",
    "roles[].summary",
    "roles[].wake",
    "roles[].wake.mode",
    "roles[].wake.session",
    "roles[].wake.via",
    "roles[].zones",
    "roles[].zones.forbidden",
    "roles[].zones.writes",
  ],

  /**
   * 21 — thread `026`: the codex `effort` vocabulary followed the vendor's live list. NO KEY
   * MOVED, and the entry is a copy of 20 for exactly that reason — this half freezes paths,
   * and the change was entirely in values (`CONFIG_VALUES[21]`, where `minimal` LEAVES). The
   * copy is not ceremony: `shape.test.ts` requires an entry at the current version, so a
   * version whose change the path half cannot see still has to say so in the table.
   */
  21: [
    "announcements",
    "announcements.force-stop",
    "identityDictionary",
    "instances",
    "instances[].account",
    "instances[].id",
    "instances[].note",
    "instances[].roles",
    "mail",
    "mail.branch",
    "mail.dir",
    "notifications",
    "notifications.stalledAfterMinutes",
    "notifications.templates",
    "notifications.templates.nudge",
    "notifications.templates.parked",
    "notifications.templates.stalled",
    "notifications.templates.turn",
    "notifications.templates.turn-with-nudge",
    "notifications.transport",
    "notifications.transport.module",
    "notifications.transport.options",
    "orchestrator",
    "orchestrator.env",
    "orchestrator.mailCheckout",
    "orchestrator.ref",
    "orchestrator.state",
    "orchestrator.workdir",
    "orchestrator.workdir.branch",
    "orchestrator.workdir.worktrees",
    "powerDocuments",
    "protocolVersion",
    "roles",
    "roles[].id",
    "roles[].instructions",
    "roles[].instructions[].kind",
    "roles[].instructions[].note",
    "roles[].instructions[].path",
    "roles[].kind",
    "roles[].launch",
    "roles[].launch.account",
    "roles[].launch.agent",
    "roles[].launch.agent.effort",
    "roles[].launch.agent.kind",
    "roles[].launch.agent.model",
    "roles[].launch.agent.toolsHeldBy",
    "roles[].launch.allowedTools",
    "roles[].launch.limits",
    "roles[].launch.limits.idleSeconds",
    "roles[].launch.limits.maxTurns",
    "roles[].launch.limits.waitInputSeconds",
    "roles[].launch.limits.wallClockSeconds",
    "roles[].launch.limits.windDownSeconds",
    "roles[].permissions",
    "roles[].status",
    "roles[].summary",
    "roles[].wake",
    "roles[].wake.mode",
    "roles[].wake.session",
    "roles[].wake.via",
    "roles[].zones",
    "roles[].zones.forbidden",
    "roles[].zones.writes",
  ],
};

/** What a shape that no longer matches its version asks for, in the words of the repair. */
export const SHAPE_REPAIR = [
  `the shape of the config changed without a new version (R2, protocolVersion ${CURRENT_PROTOCOL_VERSION}).`,
  "A field this build has never heard of is met by an OLDER build as 'Unrecognized key' — invalid,",
  "true and useless — instead of 'the config is newer, restart required', which is the one sentence",
  "that names the repair. The number is what tells those two apart (2026-07-31: a daemon died of it).",
  "Repair: bump CURRENT_PROTOCOL_VERSION, register the migration step for the previous version,",
  "raise protocolVersion in agent-protocol.json, and APPEND the new shape to CONFIG_SHAPES under the",
  "new number — the entries of released versions are history and are not edited.",
].join(" ");

/**
 * The VALUES the config pinned AS OF each protocol version. Append-only for the same reason
 * `CONFIG_SHAPES` is: an entry is the record of what a released build accepted.
 *
 * The table starts at 18 by exactly the logic that starts `CONFIG_SHAPES` at 14 — the version in
 * force when this half of the guard was written. History backwards is not invented: an entry for
 * 17 would be a claim about a build nobody can check any more, and the guard's job starts with
 * the next value, not with the last one.
 *
 * (The statement of work proposed 19. It named the logic first and the number second, and on the
 * base this landed on the logic gave 18: the PR that bumps to 19 — #74, thread `026` — was still
 * open. Recording 19 there would have meant carrying the bump, its migration step and the config
 * edit inside a guard's PR. The consequence was stated out loud and then happened: merging that
 * branch onto this one left the value `codex` without an entry at 19, and THIS DOOR is what said
 * so, by name, before any human read the diff — the change that paid for the guard became the
 * first thing the guard caught. Entry 19 below is the answer to that refusal.)
 */
export const CONFIG_VALUES: Readonly<Record<number, readonly string[]>> = {
  18: [
    'roles[].instructions[].kind = "external"',
    'roles[].instructions[].kind = "in-repo"',
    'roles[].launch.agent.effort = "high"',
    'roles[].launch.agent.effort = "low"',
    'roles[].launch.agent.effort = "max"',
    'roles[].launch.agent.effort = "medium"',
    'roles[].launch.agent.effort = "xhigh"',
    'roles[].launch.agent.kind = "claude-code"',
    'roles[].permissions[] = "launch-params"',
    'roles[].permissions[] = "task-declare"',
    'roles[].permissions[] = "thread-priority"',
    'roles[].permissions[] = "thread-status"',
    'roles[].status = "active"',
    'roles[].status = "paused"',
    'roles[].status = "planned"',
    'roles[].status = "retired"',
    'roles[].wake.mode = "event"',
    'roles[].wake.mode = "resident"',
    'roles[].wake.mode = "self"',
    'roles[].wake.mode = "via-human"',
    'roles[].wake.mode = "watch"',
  ],
  // 19 — thread `026`: `launchAgentSchema` gained a second union member, `codex`. Not one new
  // path (the member repeats the field names of the first one), one new VALUE of the
  // discriminator — the exact class this half of the guard was written for, and the first thing
  // it caught. Everything else is 18 verbatim.
  19: [
    'roles[].instructions[].kind = "external"',
    'roles[].instructions[].kind = "in-repo"',
    'roles[].launch.agent.effort = "high"',
    'roles[].launch.agent.effort = "low"',
    'roles[].launch.agent.effort = "max"',
    'roles[].launch.agent.effort = "medium"',
    'roles[].launch.agent.effort = "xhigh"',
    'roles[].launch.agent.kind = "claude-code"',
    'roles[].launch.agent.kind = "codex"',
    'roles[].permissions[] = "launch-params"',
    'roles[].permissions[] = "task-declare"',
    'roles[].permissions[] = "thread-priority"',
    'roles[].permissions[] = "thread-status"',
    'roles[].status = "active"',
    'roles[].status = "paused"',
    'roles[].status = "planned"',
    'roles[].status = "retired"',
    'roles[].wake.mode = "event"',
    'roles[].wake.mode = "resident"',
    'roles[].wake.mode = "self"',
    'roles[].wake.mode = "via-human"',
    'roles[].wake.mode = "watch"',
  ],
  // 20 — thread `026`, П2 and П1: the `codex` member gained its own `effort` vocabulary and the
  // waiver `toolsHeldBy`. TWO new rows and no edited one. `minimal` is the level codex has and
  // claude-code has not; `max` stays in the table because the OTHER member still accepts it —
  // the paths are shared by the two members of the union, so this row set is their sum, and
  // "which member accepts which level" is a distinction this projection cannot draw (the schema
  // draws it: a card naming `max` on codex is refused by the strict member).
  20: [
    'roles[].instructions[].kind = "external"',
    'roles[].instructions[].kind = "in-repo"',
    'roles[].launch.agent.effort = "high"',
    'roles[].launch.agent.effort = "low"',
    'roles[].launch.agent.effort = "max"',
    'roles[].launch.agent.effort = "medium"',
    'roles[].launch.agent.effort = "minimal"',
    'roles[].launch.agent.effort = "xhigh"',
    'roles[].launch.agent.kind = "claude-code"',
    'roles[].launch.agent.kind = "codex"',
    'roles[].launch.agent.toolsHeldBy = "sandbox-read-only"',
    'roles[].permissions[] = "launch-params"',
    'roles[].permissions[] = "task-declare"',
    'roles[].permissions[] = "thread-priority"',
    'roles[].permissions[] = "thread-status"',
    'roles[].status = "active"',
    'roles[].status = "paused"',
    'roles[].status = "planned"',
    'roles[].status = "retired"',
    'roles[].wake.mode = "event"',
    'roles[].wake.mode = "resident"',
    'roles[].wake.mode = "self"',
    'roles[].wake.mode = "via-human"',
    'roles[].wake.mode = "watch"',
  ],

  // 21 — thread `026`, john's decision of 2026-08-28: the codex `effort` vocabulary is the vendor's
  // LIVE list, and the row `= "minimal"` LEAVES the table. FIRST narrowing in this table, and the
  // difference from every entry before it is the direction of the damage: a row added breaks an
  // older build reading a newer file, a row REMOVED breaks THIS build reading a file already on
  // disk — so the version travels with a step that rewrites the value (`v21-codex-effort-
  // vocabulary.ts`), not with a note. The row `= "max"` does NOT move: it was already here from
  // the claude-code member, and this projection is the SUM of the union's members — "which member
  // takes which level" is the distinction it cannot draw, which is why the codex member gaining
  // `max` is invisible here and is pinned by `codexEffortSchema.options` in the step's test.
  21: [
    'roles[].instructions[].kind = "external"',
    'roles[].instructions[].kind = "in-repo"',
    'roles[].launch.agent.effort = "high"',
    'roles[].launch.agent.effort = "low"',
    'roles[].launch.agent.effort = "max"',
    'roles[].launch.agent.effort = "medium"',
    'roles[].launch.agent.effort = "xhigh"',
    'roles[].launch.agent.kind = "claude-code"',
    'roles[].launch.agent.kind = "codex"',
    'roles[].launch.agent.toolsHeldBy = "sandbox-read-only"',
    'roles[].permissions[] = "launch-params"',
    'roles[].permissions[] = "task-declare"',
    'roles[].permissions[] = "thread-priority"',
    'roles[].permissions[] = "thread-status"',
    'roles[].status = "active"',
    'roles[].status = "paused"',
    'roles[].status = "planned"',
    'roles[].status = "retired"',
    'roles[].wake.mode = "event"',
    'roles[].wake.mode = "resident"',
    'roles[].wake.mode = "self"',
    'roles[].wake.mode = "via-human"',
    'roles[].wake.mode = "watch"',
  ],
};

/**
 * What a value set that no longer matches its version asks for. Both directions are named,
 * because they are not the same event: a value ADDED is a config an older build cannot read, a
 * value REMOVED is a config already on disk that the NEW build cannot read — and the second one
 * needs a migration step that rewrites the file, not just a number.
 */
export const VALUES_REPAIR = [
  `the set of values the config accepts changed without a new version (R2, protocolVersion ${CURRENT_PROTOCOL_VERSION}).`,
  "Widening a frozen key is a change of the accepted config by the same letter as adding a field:",
  "an older build at an equal number meets the new value as an invalid one — 'invalid discriminator',",
  "'invalid enum value' — instead of 'the config is newer, restart required', which is the one",
  "sentence that names the repair (2026-07-31: a daemon died of the same class on a KEY).",
  "Repair: bump CURRENT_PROTOCOL_VERSION, register the migration step for the previous version,",
  "raise protocolVersion in agent-protocol.json, and APPEND the new value set to CONFIG_VALUES under",
  "the new number — the entries of released versions are history and are not edited.",
].join(" ");

/**
 * The drift itself, spelled out row by row. The refusal has to name WHICH value at WHICH path
 * moved and WHICH WAY — a reader who is told only that a list changed goes back to the schema to
 * find out what happened, which is the work the door was supposed to have done.
 */
export const describeValueDrift = (
  frozen: readonly string[],
  actual: readonly string[],
): string => {
  const lines = [
    ...actual
      .filter((row) => !frozen.includes(row))
      .map((row) => `NEWLY ACCEPTED at an unchanged version: ${row}`),
    ...frozen
      .filter((row) => !actual.includes(row))
      .map(
        (row) =>
          `NO LONGER ACCEPTED, though version ${CURRENT_PROTOCOL_VERSION} accepted it: ${row} — a config already written with this value stops parsing, so the migration step has to REWRITE it, not only renumber the file`,
      ),
  ];
  return lines.length === 0 ? "" : `\n${lines.join("\n")}`;
};
