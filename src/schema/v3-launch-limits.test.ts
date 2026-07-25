/**
 * The migration 2 → 3 (R12). The step moves a NUMBER and nothing else, so the tests
 * are about what it must NOT do: touch data, invent config fields, or let the
 * widened schema through without the number that names it.
 *
 * The fixture is the LIVE config of this repository as it stood at version 2
 * (`git show origin/main:agent-protocol.json`, 2026-07-25), copied byte for byte —
 * the same rule the previous step follows: a synthetic config would agree with
 * whatever the step believes about configs.
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
const MESSAGE = `${MAIL_ROOT}/016-protocol-roadmap/messages/2026-07-25T15-00-00Z-curator.md`;

const liveConfig = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./fixtures/config-2026-07-25-v2.json", import.meta.url)),
      "utf8",
    ),
  ) as Record<string, unknown>;

/** A context with the live config and one real-looking message file beside it. */
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

describe("the step 2 → 3 — the schema widens, the data does not move", () => {
  it("is registered for 2, so the chain to the current version has no gap", () => {
    expect(MIGRATIONS.find((step) => step.from === 2)).toBeDefined();
    // The registry must reach the version the package writes: a build whose own
    // number cannot be arrived at would refuse every repository behind it with no
    // way forward.
    for (let version = 1; version < CURRENT_PROTOCOL_VERSION; version++) {
      expect(MIGRATIONS.find((step) => step.from === version)).toBeDefined();
    }
  });

  it("writes ONE file — the config — and not a single message", () => {
    const plan = planMigration({ declared: 2, target: 3, context: context(liveConfig()) });

    expect(plan.writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.files).toEqual([]);
  });

  it("the written config differs from the live one in the NUMBER alone", () => {
    // The proof this step can carry, and the only one it needs: everything a
    // repository already declared survives the migration untouched.
    const before = liveConfig();
    const plan = planMigration({ declared: 2, target: 3, context: context(before) });
    const after = JSON.parse(plan.writes[0]?.content as string) as Record<string, unknown>;

    expect(after.protocolVersion).toBe(3);
    expect({ ...after, protocolVersion: 2 }).toEqual(before);
  });

  it("the live config at version 3 still parses — the widening is additive on read", () => {
    const plan = planMigration({ declared: 2, target: 3, context: context(liveConfig()) });

    expect(() =>
      protocolConfigSchema.parse(JSON.parse(plan.writes[0]?.content as string)),
    ).not.toThrow();
  });

  it("says out loud that the rendered file is not the thing to commit", () => {
    // "Carry the NUMBER, not the file": the runner reflows JSON, so on a config with
    // hand-written compact objects a one-line bump comes back as a sixty-line diff.
    const plan = planMigration({ declared: 2, target: 3, context: context(liveConfig()) });

    expect(plan.steps[0]?.notes.join(" ")).toContain("by hand");
  });

  it("a repository two versions behind gets BOTH steps, in order", () => {
    // The chain is what the frame promises; a step that only carries a number must
    // not become a hole in it.
    const plan = planMigration({
      declared: 1,
      target: 3,
      context: {
        ...context({ ...liveConfig(), protocolVersion: 1 }),
        list: () => [],
      },
    });

    expect(plan.steps.map((step) => [step.from, step.to])).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });
});
