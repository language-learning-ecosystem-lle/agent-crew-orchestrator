/**
 * The version that lets a role name the system user its session runs as (thread
 * `047-devops-role`). What is asserted here is what the step CLAIMS: that the widening is
 * additive, that the tables record it, and that a config written at 22 meets an older build
 * as "restart required" rather than as "invalid".
 */
import { describe, expect, it } from "vitest";

import { roleSchema } from "../roles/schema.js";
import { planMigration } from "./migrate.js";
import { CONFIG_SHAPES, CONFIG_VALUES } from "./shape.js";
import { ROLE_SYSTEM_USER_STEP } from "./v22-role-system-user.js";
import {
  CURRENT_PROTOCOL_VERSION,
  compareProtocolVersion,
  renderVersionVerdict,
} from "./version.js";

const role = {
  id: "devops",
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: "aco-devops" },
  summary: "…",
  instructions: [{ kind: "in-repo", path: "docs/roles/devops.md" }],
  launch: { allowedTools: ["Bash", "Read"] },
};

describe("roles[].systemUser", () => {
  it("is accepted as a unix user name", () => {
    expect(roleSchema.parse({ ...role, systemUser: "aco-devops" }).systemUser).toBe("aco-devops");
  });

  it("is OPTIONAL, and its absence is not a default: the field simply is not there", () => {
    expect(roleSchema.parse(role).systemUser).toBeUndefined();
  });

  it("refuses a value that is not a user name, by name", () => {
    const verdict = roleSchema.safeParse({ ...role, systemUser: "Aco Devops" });
    expect(verdict.success).toBe(false);
    expect(JSON.stringify(verdict.error?.issues)).toContain("system user name");
  });
});

describe("the version this costs, and the tables that record it", () => {
  it("is the version this build writes", () => {
    expect(CURRENT_PROTOCOL_VERSION).toBe(22);
  });

  it("answers a v22 config on a v21 build with 'restart required', not with 'invalid'", () => {
    const verdict = compareProtocolVersion(22, 21);
    expect(verdict.state).toBe("ahead");
    expect(renderVersionVerdict(verdict)).toContain("restart required");
  });

  it("the KEY table gains exactly the one path and loses none", () => {
    const before = CONFIG_SHAPES[21] ?? [];
    const after = CONFIG_SHAPES[22] ?? [];
    expect(after.filter((row) => !before.includes(row))).toEqual(["roles[].systemUser"]);
    expect(before.filter((row) => !after.includes(row))).toEqual([]);
  });

  it("the VALUE table does not move: a user name pins no vocabulary", () => {
    expect(CONFIG_VALUES[22]).toEqual(CONFIG_VALUES[21]);
  });
});

describe("the step itself", () => {
  it("writes nothing — every config valid at 21 is valid at 22", () => {
    expect(ROLE_SYSTEM_USER_STEP.from).toBe(21);
    expect(ROLE_SYSTEM_USER_STEP.plan({} as never).files ?? []).toEqual([]);
  });

  it("is registered, so the chain 21 → 22 is planned and not refused as a gap", () => {
    const plan = planMigration({
      declared: 21,
      target: 22,
      context: {
        configPath: "agent-protocol.json",
        config: { protocolVersion: 21, roles: [] },
      } as never,
    });
    expect(plan.steps.map((step) => step.to)).toEqual([22]);
  });
});
