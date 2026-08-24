import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CONFIG_SHAPES,
  CONFIG_VALUES,
  configShapeKeys,
  configShapeValues,
  describeValueDrift,
  VALUES_REPAIR,
} from "./shape.js";
import { CURRENT_PROTOCOL_VERSION } from "./version.js";

describe("the VALUES the config accepts are frozen per version (R2, curator 2026-08-23)", () => {
  it("the schema pins EXACTLY what the current version froze", () => {
    const frozen = CONFIG_VALUES[CURRENT_PROTOCOL_VERSION];
    expect(
      frozen,
      `no value set recorded for version ${CURRENT_PROTOCOL_VERSION}. ${VALUES_REPAIR}`,
    ).toBeDefined();
    const actual = configShapeValues();
    expect(actual, `${VALUES_REPAIR}${describeValueDrift(frozen ?? [], actual)}`).toEqual(frozen);
  });

  it("every recorded version is a version this package could have written", () => {
    for (const version of Object.keys(CONFIG_VALUES).map(Number)) {
      expect(version).toBeLessThanOrEqual(CURRENT_PROTOCOL_VERSION);
    }
  });

  it("the value that cost the blind spot is in the table, keyed by the path the shape half uses", () => {
    // `roles[].launch.agent.kind` has stood in CONFIG_SHAPES since 14; until this half existed,
    // the only thing frozen about it was that it EXISTS.
    expect(configShapeValues()).toContain('roles[].launch.agent.kind = "claude-code"');
    expect(CONFIG_SHAPES[CURRENT_PROTOCOL_VERSION]).toContain("roles[].launch.agent.kind");
  });
});

describe("the blind spot itself: a second union member moves no path (measured on PR #74)", () => {
  // The reproduction is on SYNTHETIC schemas rather than on the live config on purpose: it has to
  // hold both sides of the change at once — the schema before the widening and the schema after —
  // and the live config can only ever be one of them.
  const claudeOnly = z.strictObject({
    agent: z.strictObject({ kind: z.literal("claude-code"), model: z.string() }),
  });
  const withCodex = z.strictObject({
    agent: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("claude-code"), model: z.string() }),
      z.strictObject({ kind: z.literal("codex"), model: z.string() }),
    ]),
  });

  it("the PATH half stays green — this is the hole, stated as a fact rather than as a worry", () => {
    expect(configShapeKeys(withCodex)).toEqual(configShapeKeys(claudeOnly));
    expect(configShapeKeys(withCodex)).toEqual(["agent", "agent.kind", "agent.model"]);
  });

  it("the VALUE half goes red, and names the value and its path", () => {
    const before = configShapeValues(claudeOnly);
    const after = configShapeValues(withCodex);
    expect(after).not.toEqual(before);
    expect(after).toContain('agent.kind = "codex"');
    expect(describeValueDrift(before, after)).toContain(
      'NEWLY ACCEPTED at an unchanged version: agent.kind = "codex"',
    );
  });

  it("narrowing is a change too, and it is refused in the OTHER words", () => {
    // A value dropped is not the same event: the config already on disk is the one that stops
    // being readable, so the repair is a rewrite and the text says so.
    const drift = describeValueDrift(configShapeValues(withCodex), configShapeValues(claudeOnly));
    expect(drift).toContain("NO LONGER ACCEPTED");
    expect(drift).toContain('agent.kind = "codex"');
    expect(drift).toContain("REWRITE");
  });

  it("an unmoved schema drifts by nothing, and the drift text is empty", () => {
    expect(describeValueDrift(configShapeValues(), configShapeValues())).toBe("");
  });
});
