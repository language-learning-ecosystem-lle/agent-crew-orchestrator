/**
 * The step 5 → 6 (R17 + R18). The fourth widening in a row, and the tests say the
 * same thing the three before them said, because it is the property that keeps a
 * "harmless" additive change from becoming a circuit that halts with the wrong
 * diagnosis: the step moves a NUMBER, and not one file of data.
 *
 * The fixture is the LIVE config of this repository as it stood at version 5
 * (`git show origin/main:agent-protocol.json`, 2026-07-25), byte for byte.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { protocolConfigSchema } from "../config/config.js";
import { MIGRATIONS, planMigration } from "./migrate.js";
import type { MigrationContext } from "./step.js";
import { CURRENT_PROTOCOL_VERSION } from "./version.js";

const CONFIG_PATH = "/repo/agent-protocol.json";
const MAIL_ROOT = "/repo/.worktrees/comms/agent-comms";
const MESSAGE = `${MAIL_ROOT}/016-protocol-roadmap/messages/2026-07-25T20-50-00Z-curator.md`;

const liveConfig = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./fixtures/config-2026-07-25-v5.json", import.meta.url)),
      "utf8",
    ),
  ) as Record<string, unknown>;

const context = (config: Record<string, unknown>): MigrationContext => ({
  config,
  configPath: CONFIG_PATH,
  mailRoot: MAIL_ROOT,
  read: (path) => {
    if (path === MESSAGE) return "---\nfrom: curator\nworker: unknown\n---\n\nThe body.\n";
    throw new Error(`no such file: ${path}`);
  },
  list: () => [MESSAGE],
});

describe("the step 5 → 6 — the workspace and the continuation fields, no data moved", () => {
  it("is registered for 5, and the chain to the current version still has no gap", () => {
    expect(MIGRATIONS.find((step) => step.from === 5)).toBeDefined();
    for (let version = 1; version < CURRENT_PROTOCOL_VERSION; version++) {
      expect(MIGRATIONS.find((step) => step.from === version)).toBeDefined();
    }
  });

  it("writes ONE file — the config — and not a single message", () => {
    const plan = planMigration({ declared: 5, target: 6, context: context(liveConfig()) });

    expect(plan.writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.files).toEqual([]);
  });

  it("the written config differs from the live one in the NUMBER alone", () => {
    const before = liveConfig();
    const plan = planMigration({ declared: 5, target: 6, context: context(before) });
    const after = JSON.parse(plan.writes[0]?.content as string) as Record<string, unknown>;

    expect(after.protocolVersion).toBe(6);
    expect({ ...after, protocolVersion: 5 }).toEqual(before);
  });

  it("a version-5 config is a valid version-6 one — 'worktrees' is optional", () => {
    // The whole claim of "the schema widens": a repository that declares no
    // workspaces keeps raising sessions the way it did, and needs no edit at all.
    const plan = planMigration({ declared: 5, target: 6, context: context(liveConfig()) });

    expect(() =>
      protocolConfigSchema.parse(JSON.parse(plan.writes[0]?.content as string)),
    ).not.toThrow();
  });

  it("says out loud that the journal is NOT rewritten", () => {
    // The one thing a reader of this step needs to be told: old runs carry no world
    // and no session id, and the continuation policy reads that as "start fresh".
    const notes = planMigration({
      declared: 5,
      target: 6,
      context: context(liveConfig()),
    }).steps[0]?.notes.join(" ");

    expect(notes).toContain("journal is NOT rewritten");
    expect(notes).toContain("by hand");
  });

  it("a repository four versions behind gets every step, in order", () => {
    const plan = planMigration({
      declared: 2,
      target: 6,
      context: { ...context({ ...liveConfig(), protocolVersion: 2 }), list: () => [] },
    });

    expect(plan.steps.map((step) => [step.from, step.to])).toEqual([
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ]);
  });
});
