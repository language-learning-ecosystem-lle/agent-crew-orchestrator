/**
 * The migration 3 → 4 (R15). The second step in a row that moves a NUMBER and
 * nothing else, so the tests are again about what it must NOT do: touch data, invent
 * config fields, or let the widened schema through without the number that names it.
 *
 * The fixture is the LIVE config of this repository as it stood at version 3
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
      fileURLToPath(new URL("./fixtures/config-2026-07-25-v3.json", import.meta.url)),
      "utf8",
    ),
  ) as Record<string, unknown>;

const context = (config: Record<string, unknown>): MigrationContext => ({
  config,
  configPath: CONFIG_PATH,
  mailRoot: MAIL_ROOT,
  read: (path) => {
    if (path === MESSAGE) return "---\nfrom: curator\nworker: claude-ai\n---\n\nThe body.\n";
    throw new Error(`no such file: ${path}`);
  },
  list: () => [MESSAGE],
});

describe("the step 3 → 4 — the launch agent widens the schema, the data does not move", () => {
  it("is registered for 3, and the chain reaches the version the package writes", () => {
    expect(MIGRATIONS.find((step) => step.from === 3)).toBeDefined();
    for (let version = 1; version < CURRENT_PROTOCOL_VERSION; version++) {
      expect(MIGRATIONS.find((step) => step.from === version)).toBeDefined();
    }
  });

  it("writes ONE file — the config — and not a single message", () => {
    const plan = planMigration({ declared: 3, target: 4, context: context(liveConfig()) });

    expect(plan.writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.files).toEqual([]);
  });

  it("the written config differs from the live one in the NUMBER alone", () => {
    const before = liveConfig();
    const plan = planMigration({ declared: 3, target: 4, context: context(before) });
    const after = JSON.parse(plan.writes[0]?.content as string) as Record<string, unknown>;

    expect(after.protocolVersion).toBe(4);
    expect({ ...after, protocolVersion: 3 }).toEqual(before);
  });

  it("the live config at version 4 still parses — the widening is additive on read", () => {
    const plan = planMigration({ declared: 3, target: 4, context: context(liveConfig()) });

    expect(() =>
      protocolConfigSchema.parse(JSON.parse(plan.writes[0]?.content as string)),
    ).not.toThrow();
  });

  it("says out loud that the rendered file is not the thing to commit", () => {
    const plan = planMigration({ declared: 3, target: 4, context: context(liveConfig()) });

    expect(plan.steps[0]?.notes.join(" ")).toContain("by hand");
  });

  it("a repository three versions behind gets ALL the steps, in order", () => {
    // Two number-only steps in a row are exactly where a chain quietly loses one:
    // neither of them writes a file, so nothing but this would notice a gap.
    const plan = planMigration({
      declared: 1,
      target: 4,
      context: { ...context({ ...liveConfig(), protocolVersion: 1 }), list: () => [] },
    });

    expect(plan.steps.map((step) => [step.from, step.to])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
  });
});
