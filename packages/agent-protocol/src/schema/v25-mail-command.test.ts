/**
 * The version that makes HOW THE MAIL IS INVOKED a declaration of the served project
 * (thread `038-pilot-codex-live-run`). Asserted here is what the step claims: that the key
 * exists and is optional, that a config written at 25 meets an older build as "restart
 * required" rather than as "invalid", that the KEY table gains exactly one row, and that
 * the VALUE table does not move at all — the field pins nothing.
 */
import { describe, expect, it } from "vitest";

import { parseProtocolConfig } from "../config/config.js";
import { planMigration } from "./migrate.js";
import { CONFIG_SHAPES, CONFIG_VALUES } from "./shape.js";
import { MAIL_COMMAND_STEP } from "./v25-mail-command.js";
import {
  compareProtocolVersion,
  CURRENT_PROTOCOL_VERSION,
  renderVersionVerdict,
} from "./version.js";

const config = (over: Record<string, unknown>): Record<string, unknown> => ({
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "…",
      instructions: [{ kind: "in-repo", path: "CARD.md" }],
    },
  ],
  ...over,
});

describe("mailCommand — the invocation is the project's to declare", () => {
  it("accepts the declared form as one free string", () => {
    const command = "node --import tsx packages/agent-protocol/src/cli.ts";
    expect(parseProtocolConfig(config({ mailCommand: command })).mailCommand).toBe(command);
  });

  it("is OPTIONAL — a project that declares nothing is a valid project", () => {
    // Absence is the honest state and the package must keep parsing it: what changes with
    // this version is that the PROMPT then says the form is undeclared, not that the config
    // is refused. A required key would have made every served repository declare a shell
    // line before it could be read at all.
    expect(parseProtocolConfig(config({})).mailCommand).toBeUndefined();
  });

  it("refuses an empty string — a declaration of nothing is worse than no declaration", () => {
    // It would reach the prompt as a leading space in front of every command: a form that
    // looks declared, reads as broken and repairs nothing.
    expect(() => parseProtocolConfig(config({ mailCommand: "" }))).toThrow();
  });
});

describe("the version this costs, and the tables that record it", () => {
  it("is the version this build writes", () => {
    expect(CURRENT_PROTOCOL_VERSION).toBe(25);
  });

  it("answers a v25 config on a v24 build with 'restart required', not with 'invalid'", () => {
    // The whole reason an optional key costs a number: a strict schema one field behind
    // answers `Unrecognized key: mailCommand`, which is invalid, true and useless — the
    // class that killed a live daemon on 2026-07-31.
    const verdict = compareProtocolVersion(25, 24);

    expect(verdict.state).toBe("ahead");
    expect(renderVersionVerdict(verdict)).toContain("restart required");
  });

  it("the KEY table gains exactly one path and loses none", () => {
    const before = CONFIG_SHAPES[24] ?? [];
    const after = CONFIG_SHAPES[25] ?? [];

    expect(after.filter((row) => !before.includes(row))).toEqual(["mailCommand"]);
    expect(before.filter((row) => !after.includes(row))).toEqual([]);
  });

  it("the VALUE table does NOT move — the field is a free string and pins nothing", () => {
    // Recorded rather than skipped: a version with no entry here reads as a version nobody
    // checked, and the guard's own rule is that silence is the failure mode.
    expect(CONFIG_VALUES[25]).toEqual(CONFIG_VALUES[24]);
  });
});

describe("the step itself", () => {
  it("writes nothing — every config valid at 24 is valid at 25", () => {
    expect(MAIL_COMMAND_STEP.from).toBe(24);
    expect(MAIL_COMMAND_STEP.plan({} as never).files ?? []).toEqual([]);
  });

  it("declares the value for nobody — the invocation is a fact about one deployment", () => {
    // The reason of v18 verbatim: a migration that filled this in would compile one
    // project's shell line into a package built to travel.
    expect(MAIL_COMMAND_STEP.plan({} as never).notes.join(" ")).toContain("declares it for nobody");
  });

  it("is registered, so the chain 24 → 25 is planned and not refused as a gap", () => {
    const plan = planMigration({
      declared: 24,
      target: 25,
      context: {
        configPath: "agent-protocol.json",
        config: { protocolVersion: 24, roles: [] },
      } as never,
    });

    expect(plan.steps.map((step) => step.to)).toEqual([25]);
  });
});
