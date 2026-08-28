import { describe, expect, it } from "vitest";

import {
  CONFIG_REFLOW_NOTE,
  MIGRATIONS,
  type MigrationContext,
  MigrationRefusedError,
  type MigrationStep,
  planMigration,
  renderMigrationPlan,
  rendersConfig,
} from "./migrate.js";
import { CURRENT_PROTOCOL_VERSION } from "./version.js";

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

  it("the chain reaches the version the package writes — a bump without a step is a repository that cannot migrate", () => {
    // The failure this pins is one keystroke wide and silent until somebody else's
    // repository is one version behind: bump `CURRENT_PROTOCOL_VERSION`, forget the
    // step, and `schema migrate` refuses the gap instead of migrating.
    for (let from = 1; from < CURRENT_PROTOCOL_VERSION; from += 1) {
      expect(MIGRATIONS.find((step) => step.from === from)).toBeDefined();
    }
    expect(MIGRATIONS.find((step) => step.from === CURRENT_PROTOCOL_VERSION)).toBeUndefined();
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

describe("the reflow note", () => {
  const changing: MigrationStep = {
    from: 1,
    summary: "changes a value in the config",
    plan: (context) => ({ config: { ...context.config, mail: { branch: "renamed" } } }),
  };

  it("is owed by every plan that re-renders the config, whatever the step did", () => {
    // The property belongs to `renderConfig`, so it is asked of the WRITES: a step
    // that touches only the config still produces a re-rendered file.
    const plan = planMigration({
      declared: 1,
      target: 2,
      context: contextWith(),
      steps: [changing],
    });

    expect(plan.configPath).toBe(CONFIG_PATH);
    expect(rendersConfig(plan)).toBe(true);
  });

  it("is not owed by a plan that writes nothing — an empty plan renders no file", () => {
    // The other half of the note's worth: one printed on every run is one nobody
    // reads by the second run.
    const plan = planMigration({ declared: 1, target: 1, context: contextWith(), steps: [] });

    expect(rendersConfig(plan)).toBe(false);
  });

  it("names the class of the repair and no vendor's tool", () => {
    // The package does not know what the consumer formats with, and naming one would
    // be a rule it has no standing to make. `biome` is this repository's choice, not
    // the protocol's.
    expect(CONFIG_REFLOW_NOTE).toContain("formatter");
    expect(CONFIG_REFLOW_NOTE.toLowerCase()).not.toContain("biome");
    expect(CONFIG_REFLOW_NOTE.toLowerCase()).not.toContain("prettier");
  });
});
