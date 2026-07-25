import { describe, expect, it } from "vitest";

import {
  MIGRATIONS,
  type MigrationContext,
  MigrationRefusedError,
  type MigrationStep,
  planMigration,
  renderMigrationPlan,
} from "./migrate.js";

const CONFIG_PATH = "/repo/agent-protocol.json";
const MAIL_ROOT = "/repo/.worktrees/comms/agent-comms";

const contextWith = (
  disk: Record<string, string> = {},
  config: Record<string, unknown> = { protocolVersion: 1, mail: { branch: "comms" } },
): MigrationContext => ({
  config,
  configPath: CONFIG_PATH,
  mailRoot: MAIL_ROOT,
  read: (path) => {
    const content = disk[path];
    if (content === undefined) throw new Error(`no such file: ${path}`);
    return content;
  },
  list: () => Object.keys(disk),
});

/** A step that appends its own mark to one message file — enough to see chaining. */
const marking = (from: number, mark: string): MigrationStep => ({
  from,
  summary: `mark the message with ${mark}`,
  plan: (context) => ({
    files: [{ path: `${MAIL_ROOT}/m.md`, content: `${context.read(`${MAIL_ROOT}/m.md`)}${mark}` }],
  }),
});

describe("MIGRATIONS", () => {
  it("holds one step per version, keyed by the version it comes FROM", () => {
    // The registry stayed empty until the change that needed it (R7): a frame
    // written before its first migration would be guessing. What the list must
    // guarantee now is that a version has AT MOST ONE step — two would make the
    // chain depend on the order the array happens to be in.
    const froms = MIGRATIONS.map((step) => step.from);

    expect(froms).toEqual([...new Set(froms)]);
    expect(MIGRATIONS.every((step) => step.summary.trim() !== "")).toBe(true);
  });

  it("registers the step for 1 → 2 — the row the README's version table describes", () => {
    expect(MIGRATIONS.find((step) => step.from === 1)).toBeDefined();
  });
});

describe("planMigration", () => {
  it("plans nothing when the repository is already at the target", () => {
    const plan = planMigration({ declared: 1, target: 1, context: contextWith(), steps: [] });

    expect(plan.steps).toEqual([]);
    expect(plan.writes).toEqual([]);
    expect(renderMigrationPlan(plan)).toBe("protocol version 1 — nothing to migrate");
  });

  it("bumps the version itself — a step cannot forget it", () => {
    // Property 1 of the frame: half-migrated data with a truthful version is
    // recoverable, migrated data with a lying version is the state the package
    // exists to prevent. So the runner writes the number, not the step.
    const forgetful: MigrationStep = { from: 1, summary: "changes nothing", plan: () => ({}) };

    const plan = planMigration({
      declared: 1,
      target: 2,
      context: contextWith(),
      steps: [forgetful],
    });

    const config = plan.writes.find((file) => file.path === CONFIG_PATH);
    expect(config).toBeDefined();
    expect(JSON.parse((config as { content: string }).content)).toEqual({
      protocolVersion: 2,
      mail: { branch: "comms" },
    });
  });

  it("hands a later step what the earlier one wrote, not what is on disk", () => {
    // Property 3. A step reading stale bytes would silently discard the previous
    // step's work — and the loss would only surface long after the write.
    const plan = planMigration({
      declared: 1,
      target: 3,
      context: contextWith({ [`${MAIL_ROOT}/m.md`]: "body" }),
      steps: [marking(1, "-one"), marking(2, "-two")],
    });

    expect(plan.steps.map((step) => [step.from, step.to])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    // One entry per path with the LAST content — writing the intermediate state to
    // disk is exactly the half-migrated state the frame refuses to produce.
    const message = plan.writes.filter((file) => file.path === `${MAIL_ROOT}/m.md`);
    expect(message).toHaveLength(1);
    expect(message[0]?.content).toBe("body-one-two");
  });

  it("writes the config LAST, after the data files it describes", () => {
    const plan = planMigration({
      declared: 1,
      target: 2,
      context: contextWith({ [`${MAIL_ROOT}/m.md`]: "body" }),
      steps: [marking(1, "!")],
    });

    expect(plan.writes.at(-1)?.path).toBe(CONFIG_PATH);
  });

  it("refuses a chain with a gap without running a single step", () => {
    // Property 2: five applied steps and then a stop would leave the repository at
    // a version no build of the package supports. The chain is assembled first, so
    // the step before the gap is not even planned — otherwise its own failure could
    // hide the gap behind an unrelated message.
    let ran = 0;
    const counting: MigrationStep = {
      from: 1,
      summary: "counts its runs",
      plan: () => {
        ran++;
        return {};
      },
    };

    expect(() =>
      planMigration({ declared: 1, target: 3, context: contextWith(), steps: [counting] }),
    ).toThrow(MigrationRefusedError);
    expect(ran).toBe(0);

    try {
      planMigration({ declared: 1, target: 3, context: contextWith(), steps: [counting] });
      expect.unreachable("the gap was not caught");
    } catch (error) {
      expect((error as Error).message).toContain("2 → 3");
    }
  });

  it("refuses a downgrade", () => {
    expect(() =>
      planMigration({ declared: 3, target: 1, context: contextWith(), steps: [] }),
    ).toThrow(/a downgrade is not performed/);
  });

  it("carries a step's hand-work notes into the plan instead of applying them", () => {
    const withNote: MigrationStep = {
      from: 1,
      summary: "asks for a hand",
      plan: () => ({ notes: ["restart the daemon after the merge"] }),
    };

    const plan = planMigration({
      declared: 1,
      target: 2,
      context: contextWith(),
      steps: [withNote],
    });

    expect(renderMigrationPlan(plan)).toContain(
      "NOTE (by hand): restart the daemon after the merge",
    );
  });
});
