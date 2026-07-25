/**
 * The step 4 → 5 (R4). As with 2 → 3 and 3 → 4, the step moves a NUMBER, so the
 * tests are about what it must NOT do: touch data, invent config fields, or let the
 * widened schema through without the number that names it.
 *
 * The fixture is the LIVE config of this repository as it stood at version 4
 * (`git show origin/main:agent-protocol.json`, 2026-07-25), copied byte for byte — a
 * synthetic config would agree with whatever the step believes about configs.
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
const MESSAGE = `${MAIL_ROOT}/016-protocol-roadmap/messages/2026-07-25T19-50-00Z-curator.md`;

const liveConfig = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./fixtures/config-2026-07-25-v4.json", import.meta.url)),
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

describe("the step 4 → 5 — the texts become data, the data does not move", () => {
  it("is registered for 4, and the chain to the current version still has no gap", () => {
    expect(MIGRATIONS.find((step) => step.from === 4)).toBeDefined();
    for (let version = 1; version < CURRENT_PROTOCOL_VERSION; version++) {
      expect(MIGRATIONS.find((step) => step.from === version)).toBeDefined();
    }
  });

  it("writes ONE file — the config — and not a single message", () => {
    const plan = planMigration({ declared: 4, target: 5, context: context(liveConfig()) });

    expect(plan.writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.files).toEqual([]);
  });

  it("the written config differs from the live one in the NUMBER alone", () => {
    const before = liveConfig();
    const plan = planMigration({ declared: 4, target: 5, context: context(before) });
    const after = JSON.parse(plan.writes[0]?.content as string) as Record<string, unknown>;

    expect(after.protocolVersion).toBe(5);
    expect({ ...after, protocolVersion: 4 }).toEqual(before);
  });

  it("a version-4 config is a valid version-5 one — the sections are optional", () => {
    // The whole claim of "the schema widens": a repository that says nothing about
    // texts keeps the package's English defaults and needs no edit at all.
    const plan = planMigration({ declared: 4, target: 5, context: context(liveConfig()) });

    expect(() =>
      protocolConfigSchema.parse(JSON.parse(plan.writes[0]?.content as string)),
    ).not.toThrow();
  });

  it("says out loud that the rendered file is not the thing to commit", () => {
    const plan = planMigration({ declared: 4, target: 5, context: context(liveConfig()) });

    expect(plan.steps[0]?.notes.join(" ")).toContain("by hand");
  });

  it("a repository three versions behind gets every step, in order", () => {
    const plan = planMigration({
      declared: 2,
      target: 5,
      context: { ...context({ ...liveConfig(), protocolVersion: 2 }), list: () => [] },
    });

    expect(plan.steps.map((step) => [step.from, step.to])).toEqual([
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
  });
});
