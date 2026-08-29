/**
 * VERSION 21 — THE FIRST NARROWING (thread `026-codex-agent-kind`; john's decision of
 * 2026-08-28). Four doors are asked here, and the third is the one this version exists for:
 *
 *  1. the VOCABULARY — the list `codexEffortSchema` carries is the vendor's live one:
 *     `max` in, `minimal` out, `ultra` deliberately out. Pinned by literal, because a list
 *     asserted against itself pins nothing;
 *  2. the DOORS the list feeds — a card naming `max` is now RAISED and a card naming
 *     `minimal` is now REFUSED BY NAME, and the refusal prints the levels. Both halves,
 *     because the direction of the change is different on each side;
 *  3. the MIGRATION — a config at 20 carrying `minimal` is data this build cannot read, so
 *     the step rewrites it and the plan says so. Asserted on the value, not on the note;
 *  4. the TABLES — the value row leaves at 21, the released entry at 20 is untouched, and
 *     no key path moves at all.
 */
import { describe, expect, it } from "vitest";

import { buildCodexArgv, CODEX, codexEffortSchema } from "../orchestrator/codex.js";
import { resolveAgentParams } from "../orchestrator/launch.js";
import { type Launch, launchSchema } from "../roles/schema.js";
import { planMigration } from "./migrate.js";
import { CONFIG_SHAPES, CONFIG_VALUES } from "./shape.js";
import type { MigrationContext } from "./step.js";
import {
  CODEX_EFFORT_VOCABULARY_STEP,
  retireCodexMinimalEffort,
} from "./v21-codex-effort-vocabulary.js";
import {
  CURRENT_PROTOCOL_VERSION,
  compareProtocolVersion,
  renderVersionVerdict,
} from "./version.js";

const WAIVER = { kind: "codex", toolsHeldBy: "sandbox-read-only" } as const;

/** A config at 20 shaped like the live one: one codex card, one claude-code card beside it. */
const configAt20 = (effort: string): Record<string, unknown> => ({
  protocolVersion: 20,
  roles: [
    {
      id: "dev-core",
      launch: { agent: { kind: "claude-code", model: "claude-opus-5[1m]", effort: "high" } },
    },
    {
      id: "pilot-codex",
      launch: {
        agent: {
          kind: "codex",
          model: "gpt-5-codex",
          effort,
          toolsHeldBy: "sandbox-read-only",
        },
      },
    },
  ],
});

const context = (config: Record<string, unknown>): MigrationContext => ({
  config,
  configPath: "/repo/agent-protocol.json",
  mailRoot: "/repo/.worktrees/comms/agent-comms",
  read: () => {
    throw new Error("this step reads no file");
  },
  list: () => [],
});

describe("the vocabulary is the vendor's live list, and it is pinned by literal", () => {
  it("five levels: max is in, minimal is gone, ultra is not taken", () => {
    expect(codexEffortSchema.options).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(CODEX.effortLevels).toEqual(codexEffortSchema.options);
    expect(codexEffortSchema.options).not.toContain("minimal");
    expect(codexEffortSchema.options).not.toContain("ultra");
  });

  it("a card naming `max` is now built, where version 20 refused it", () => {
    const resolved = resolveAgentParams({
      flags: { effort: "max" },
      worker: { value: "codex", source: "flag" },
      kind: CODEX,
    });
    expect(resolved.ok).toBe(true);
  });

  it("a card naming `minimal` is refused BY NAME, and the refusal prints the levels", () => {
    // The whole point of retiring it: the old enum bought a run that died at the vendor with
    // a spent lease, and this is the sentence that replaces that run.
    const resolved = resolveAgentParams({
      flags: { effort: "minimal" },
      worker: { value: "codex", source: "flag" },
      kind: CODEX,
    });
    expect(resolved.ok).toBe(false);
    const said = (resolved as { reason: string }).reason;
    expect(said).toContain("--effort 'minimal'");
    expect(said).toContain("allowed levels of 'codex' are low, medium, high, xhigh, max");
  });

  it("the card of the pilot, as it now stands, becomes the argv john's decision named", () => {
    // The live acceptance is a run in the thread; what a test can hold is that the two values
    // of the card reach the command line as themselves, spelled codex's way.
    const launch = launchSchema.parse({
      agent: { ...WAIVER, model: "gpt-5.4-mini", effort: "low" },
    }) as Launch;
    const resolved = resolveAgentParams({
      flags: {},
      worker: { value: "codex", source: "role" },
      kind: CODEX,
      launch,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const argv = buildCodexArgv({
      prompt: "work",
      maxTurns: "300",
      launch,
      params: resolved.params,
    });
    expect(argv.join(" ")).toContain("-m gpt-5.4-mini");
    expect(argv.join(" ")).toContain("-c model_reasoning_effort=low");
    expect(argv.join(" ")).toContain("--sandbox read-only");
  });
});

describe("the step rewrites the data, because a narrowing is not repaired by a number", () => {
  it("`minimal` on a codex card becomes `low`, and the role is named", () => {
    const { config, roles } = retireCodexMinimalEffort(configAt20("minimal"));
    expect(roles).toEqual(["pilot-codex"]);
    const rewritten = config.roles as Array<Record<string, unknown>>;
    expect(rewritten[1]?.launch).toMatchObject({ agent: { effort: "low" } });
    // Everything else of the card survives — including the model, which this step does not pick.
    expect(rewritten[1]?.launch).toMatchObject({
      agent: { kind: "codex", model: "gpt-5-codex", toolsHeldBy: "sandbox-read-only" },
    });
    expect(rewritten[0]).toEqual((configAt20("minimal").roles as unknown[])[0]);
  });

  it("a config that names no `minimal` is returned untouched, by identity", () => {
    const before = configAt20("high");
    const { config, roles } = retireCodexMinimalEffort(before);
    expect(roles).toEqual([]);
    expect(config).toBe(before);
  });

  it("the claude-code member is not touched even where it carries the same word", () => {
    // Its vocabulary never had `minimal`; a step that swept the value by name across both
    // members would be repairing a config the other schema had already refused.
    const config = {
      roles: [{ id: "x", launch: { agent: { kind: "claude-code", effort: "minimal" } } }],
    };
    expect(retireCodexMinimalEffort(config).config).toBe(config);
  });

  it("a config too broken to read is passed through rather than crashed on", () => {
    expect(retireCodexMinimalEffort({}).roles).toEqual([]);
    expect(retireCodexMinimalEffort({ roles: "not an array" }).roles).toEqual([]);
    expect(retireCodexMinimalEffort({ roles: [null, 7, { launch: 3 }] }).roles).toEqual([]);
  });

  it("the plan writes the config and says which value it moved", () => {
    const plan = planMigration({
      declared: 20,
      target: 21,
      context: context(configAt20("minimal")),
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.notes.join(" ")).toContain("'minimal' → 'low'");
    expect(plan.steps[0]?.notes.join(" ")).toContain("pilot-codex");

    const written = plan.writes.find((file) => file.path === "/repo/agent-protocol.json");
    expect(written).toBeDefined();
    const after = JSON.parse(written?.content ?? "{}") as Record<string, unknown>;
    expect(after.protocolVersion).toBe(21);
    const roles = after.roles as Array<Record<string, unknown>>;
    expect(roles[1]?.launch).toMatchObject({ agent: { effort: "low" } });
  });

  it("and on a config with nothing to rewrite it is still the version that moves", () => {
    const plan = planMigration({ declared: 20, target: 21, context: context(configAt20("high")) });
    const written = plan.writes.find((file) => file.path === "/repo/agent-protocol.json");
    expect(JSON.parse(written?.content ?? "{}")).toMatchObject({ protocolVersion: 21 });
    expect(plan.steps[0]?.notes.join(" ")).toContain("no card names 'minimal'");
  });

  it("the step is registered where the chain looks for it", () => {
    expect(CODEX_EFFORT_VOCABULARY_STEP.from).toBe(20);
    // A gap would be a refusal of the whole chain — asserted through the frame, not the array.
    expect(() =>
      planMigration({ declared: 20, target: 21, context: context(configAt20("low")) }),
    ).not.toThrow();
  });
});

describe("the version this costs, and the tables that record it", () => {
  // 21 stopped being the version this build writes when 22 landed (thread `047-devops-role`).
  // The claim that survives the next bump is the one this test was making: the version exists
  // and is not ahead of the build.
  it("is a version this build knows", () => {
    expect(CURRENT_PROTOCOL_VERSION).toBeGreaterThanOrEqual(21);
  });

  it("answers a v21 config on a v20 build with 'restart required', not with 'invalid'", () => {
    const verdict = compareProtocolVersion(21, 20);
    expect(verdict.state).toBe("ahead");
    expect(renderVersionVerdict(verdict)).toContain("restart required");
  });

  it("the VALUE table loses exactly one row and gains none", () => {
    const before = CONFIG_VALUES[20] ?? [];
    const after = CONFIG_VALUES[21] ?? [];
    expect(before.filter((row) => !after.includes(row))).toEqual([
      'roles[].launch.agent.effort = "minimal"',
    ]);
    // `max` gains nothing here on purpose: the row was already contributed by the other member,
    // and this projection is the SUM of the union. The codex half of it is pinned by the enum.
    expect(after.filter((row) => !before.includes(row))).toEqual([]);
    expect(after).toContain('roles[].launch.agent.effort = "max"');
  });

  it("the released entry at 20 is history and is not edited", () => {
    expect(CONFIG_VALUES[20]).toContain('roles[].launch.agent.effort = "minimal"');
  });

  it("no key path moves — the change is entirely in values", () => {
    expect(CONFIG_SHAPES[21]).toEqual(CONFIG_SHAPES[20]);
  });
});
