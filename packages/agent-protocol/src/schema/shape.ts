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
 */
import { z } from "zod";

import { protocolConfigSchema } from "../config/config.js";
import { CURRENT_PROTOCOL_VERSION } from "./version.js";

/**
 * Every key path the config schema accepts, sorted — `a.b`, and `a[].b` for the members of an
 * array or of a record's values.
 *
 * Derived from the schema through its JSON-Schema projection rather than from zod's internals:
 * the projection is a public contract of the library, and a walker over `_def` would be a
 * second thing to fix on every zod upgrade — in a guard whose whole value is that it does not
 * quietly stop working.
 */
export const configShapeKeys = (): readonly string[] => {
  const json = z.toJSONSchema(protocolConfigSchema, { io: "input", unrepresentable: "any" });
  const keys = new Set<string>();
  const walk = (node: unknown, at: string): void => {
    if (node === null || typeof node !== "object") return;
    const shape = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(
      (shape.properties as Record<string, unknown>) ?? {},
    )) {
      const path = at === "" ? key : `${at}.${key}`;
      keys.add(path);
      walk(value, path);
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
  return [...keys].sort();
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
