/**
 * The step 7 → 8 (R20). The sixth widening in a row, and the tests say what the five
 * before them said, because it is the property that keeps a "harmless" additive change
 * from becoming a circuit that halts with the wrong diagnosis: the step moves a NUMBER,
 * and not one file of data.
 *
 * The claim specific to this version: R20 adds nothing to the JOURNAL either. Its other
 * two parts travel by channels that store nothing — the environment of the child process
 * and the launch prompt — and `timeout` keeps its name while changing its meaning.
 *
 * The fixture is the LIVE config of this repository as it stood at version 7
 * (`git show origin/main:agent-protocol.json`, 2026-07-26), byte for byte.
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

const liveConfig = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./fixtures/config-2026-07-26-v7.json", import.meta.url)),
      "utf8",
    ),
  ) as Record<string, unknown>;

const context = (config: Record<string, unknown>): MigrationContext => ({
  config,
  configPath: CONFIG_PATH,
  mailRoot: MAIL_ROOT,
  read: (path) => {
    throw new Error(`no such file: ${path}`);
  },
  list: () => [],
});

describe("the step 7 → 8 — the graceful deadline, no data moved", () => {
  it("is registered for 7, and the chain to the current version still has no gap", () => {
    expect(MIGRATIONS.find((step) => step.from === 7)).toBeDefined();
    for (let version = 1; version < CURRENT_PROTOCOL_VERSION; version++) {
      expect(MIGRATIONS.find((step) => step.from === version)).toBeDefined();
    }
  });

  it("writes ONE file — the config — and not a single message", () => {
    const plan = planMigration({ declared: 7, target: 8, context: context(liveConfig()) });

    expect(plan.writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.files).toEqual([]);
  });

  it("the written config differs from the live one in the NUMBER alone", () => {
    const before = liveConfig();
    const plan = planMigration({ declared: 7, target: 8, context: context(before) });
    const after = JSON.parse(plan.writes[0]?.content as string) as Record<string, unknown>;

    expect(after.protocolVersion).toBe(8);
    expect({ ...after, protocolVersion: 7 }).toEqual(before);
  });

  it("a version-7 config is a valid version-8 one — 'windDownSeconds' is optional", () => {
    const plan = planMigration({ declared: 7, target: 8, context: context(liveConfig()) });

    expect(() =>
      protocolConfigSchema.parse(JSON.parse(plan.writes[0]?.content as string)),
    ).not.toThrow();
  });

  it("says out loud that neither the journal nor the mail is touched", () => {
    // The claim that separates R20 from the versions that DID move data: the deadline
    // reaches a session through its environment and its prompt, and neither is stored —
    // so there is nothing on disk written in the old shape to convert.
    const notes = planMigration({
      declared: 7,
      target: 8,
      context: context(liveConfig()),
    }).steps[0]?.notes.join(" ");

    expect(notes).toContain("journal is NOT rewritten");
    expect(notes).toContain("environment");
    expect(notes).toContain("by hand");
  });

  it("a repository six versions behind gets every step, in order", () => {
    const plan = planMigration({
      declared: 2,
      target: 8,
      context: { ...context({ ...liveConfig(), protocolVersion: 2 }), list: () => [] },
    });

    expect(plan.steps.map((step) => [step.from, step.to])).toEqual([
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
    ]);
  });
});
