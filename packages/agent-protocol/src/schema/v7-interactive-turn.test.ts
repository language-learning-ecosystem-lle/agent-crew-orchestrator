/**
 * The step 6 → 7 (R19). The fifth widening in a row, and the tests say what the four
 * before them said, because it is the property that keeps a "harmless" additive change
 * from becoming a circuit that halts with the wrong diagnosis: the step moves a NUMBER,
 * and not one file of data.
 *
 * One claim is specific to this version and is checked here as well: R19 adds nothing
 * to the shape of the MAIL, so no thread needs migrating and no message is rewritten.
 *
 * The fixture is the LIVE config of this repository as it stood at version 6
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
const MESSAGE = `${MAIL_ROOT}/016-protocol-roadmap/messages/2026-07-25T23-45-00Z-curator.md`;

const liveConfig = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./fixtures/config-2026-07-26-v6.json", import.meta.url)),
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

describe("the step 6 → 7 — the interactive turn, no data moved", () => {
  it("is registered for 6, and the chain to the current version still has no gap", () => {
    expect(MIGRATIONS.find((step) => step.from === 6)).toBeDefined();
    for (let version = 1; version < CURRENT_PROTOCOL_VERSION; version++) {
      expect(MIGRATIONS.find((step) => step.from === version)).toBeDefined();
    }
  });

  it("writes ONE file — the config — and not a single message", () => {
    const plan = planMigration({ declared: 6, target: 7, context: context(liveConfig()) });

    expect(plan.writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.files).toEqual([]);
  });

  it("the written config differs from the live one in the NUMBER alone", () => {
    const before = liveConfig();
    const plan = planMigration({ declared: 6, target: 7, context: context(before) });
    const after = JSON.parse(plan.writes[0]?.content as string) as Record<string, unknown>;

    expect(after.protocolVersion).toBe(7);
    expect({ ...after, protocolVersion: 6 }).toEqual(before);
  });

  it("a version-6 config is a valid version-7 one — 'waitInputSeconds' is optional", () => {
    const plan = planMigration({ declared: 6, target: 7, context: context(liveConfig()) });

    expect(() =>
      protocolConfigSchema.parse(JSON.parse(plan.writes[0]?.content as string)),
    ).not.toThrow();
  });

  it("says out loud that the mail is not touched — no thread needs migrating", () => {
    // The claim that distinguishes this version from 1 → 2: aliveness of a parked
    // session is a fact about the run, not a field of a message header, so the feed,
    // the assembled `_thread.md` and the INDEX all stay exactly as they are.
    const notes = planMigration({
      declared: 6,
      target: 7,
      context: context(liveConfig()),
    }).steps[0]?.notes.join(" ");

    expect(notes).toContain("mail is not touched");
    expect(notes).toContain("by hand");
  });

  it("a repository five versions behind gets every step, in order", () => {
    const plan = planMigration({
      declared: 2,
      target: 7,
      context: { ...context({ ...liveConfig(), protocolVersion: 2 }), list: () => [] },
    });

    expect(plan.steps.map((step) => [step.from, step.to])).toEqual([
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
    ]);
  });
});
