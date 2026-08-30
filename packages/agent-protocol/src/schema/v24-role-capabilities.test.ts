/**
 * The version that lets a role declare WHAT IT MAY DO TO THE BOX (thread `047-devops-role`).
 * Asserted here is what the step CLAIMS: that the grammar is closed at every point where a free
 * string would have been an open door, that every refusal names what is wrong, that both halves
 * of the shape guard record the widening, and that a config written at 24 meets an older build
 * as "restart required" rather than as "invalid".
 */
import { describe, expect, it } from "vitest";

import { CAPABILITY_NAMES, capabilitiesSchema, LOG_TAIL_MAX_LINES } from "../roles/capabilities.js";
import { roleSchema } from "../roles/schema.js";
import { planMigration } from "./migrate.js";
import { CONFIG_SHAPES, CONFIG_VALUES } from "./shape.js";
import { ROLE_CAPABILITIES_STEP } from "./v24-role-capabilities.js";
import {
  CURRENT_PROTOCOL_VERSION,
  compareProtocolVersion,
  renderVersionVerdict,
} from "./version.js";

const role = {
  id: "devops",
  kind: "claude-code",
  status: "planned",
  wake: { mode: "watch", session: "crew-devops" },
  summary: "…",
  instructions: [{ kind: "in-repo", path: "docs/roles/devops.md" }],
};

const refresh = {
  name: "repo-refresh",
  checkouts: ["/home/lle/projects/agent-crew-orchestrator"],
};

describe("roles[].capabilities — the verb is declared, and so is what it may be aimed at", () => {
  it("accepts the three verbs of the decision, and no fourth exists to be spelled", () => {
    expect([...CAPABILITY_NAMES]).toEqual(["log-tail", "repo-refresh", "disk-free"]);
  });

  /**
   * The two verbs struck on 2026-08-30 ((A) now, (B) if the hand-restarts add up) are refused by
   * the SAME refusal a typo gets, and that is the point: they are outside the vocabulary, not
   * inside it and unused. A config could otherwise declare a verb that the operating system
   * refuses by construction — a user bus belongs to its own user — and nothing would say so.
   */
  it("refuses the two verbs held back for decision (B): they are not in the vocabulary at all", () => {
    for (const name of ["service-restart", "service-status"]) {
      const verdict = capabilitiesSchema.safeParse([{ name, units: ["agent-protocol@hetzner"] }]);

      expect(verdict.success).toBe(false);
      const said = JSON.stringify(verdict.error?.issues);
      for (const known of CAPABILITY_NAMES) expect(said).toContain(known);
    }
  });

  it("is OPTIONAL, and its absence is not a default: a role that does nothing to the box", () => {
    expect(roleSchema.parse(role).capabilities).toBeUndefined();
  });

  it("carries the closed list through the parse unchanged — the list is data, not a hint", () => {
    const parsed = roleSchema.parse({ ...role, capabilities: [refresh] });

    expect(parsed.capabilities).toEqual([refresh]);
  });

  it("refuses a verb nobody declared, and the refusal quotes the set instead of saying 'unknown'", () => {
    const verdict = capabilitiesSchema.safeParse([{ name: "exec", command: "rm -rf /" }]);
    expect(verdict.success).toBe(false);

    // The whole construction stands on this refusal: a free-form verb is a shell by another
    // name, and a reader who is told only "invalid" goes looking for the vocabulary by hand.
    const said = JSON.stringify(verdict.error?.issues);
    for (const name of CAPABILITY_NAMES) expect(said).toContain(name);
  });

  it("refuses a parameter that belongs to another verb — 'disk-free' has nothing to aim", () => {
    const verdict = capabilitiesSchema.safeParse([
      { name: "disk-free", checkouts: ["/home/lle/projects/agent-crew-orchestrator"] },
    ]);

    expect(verdict.success).toBe(false);
    expect(JSON.stringify(verdict.error?.issues)).toContain("checkouts");
  });

  it("refuses an EMPTY closed list by name: it is not 'nothing allowed', it is nothing said", () => {
    const verdict = capabilitiesSchema.safeParse([{ name: "repo-refresh", checkouts: [] }]);

    expect(verdict.success).toBe(false);
    expect(JSON.stringify(verdict.error?.issues)).toContain(
      "the closed list 'checkouts' of the capability 'repo-refresh' is empty",
    );
  });

  it("refuses a missing closed list: a verb without its list would aim at everything", () => {
    const verdict = capabilitiesSchema.safeParse([{ name: "repo-refresh" }]);

    expect(verdict.success).toBe(false);
    expect(JSON.stringify(verdict.error?.issues)).toContain("checkouts");
  });

  it("holds the ceiling of 'log-tail' and names it when it is passed", () => {
    const tail = (maxLines: number) => [{ name: "log-tail", logs: ["daemon.log"], maxLines }];

    expect(capabilitiesSchema.safeParse(tail(LOG_TAIL_MAX_LINES)).success).toBe(true);
    const verdict = capabilitiesSchema.safeParse(tail(LOG_TAIL_MAX_LINES + 1));
    expect(verdict.success).toBe(false);
    expect(JSON.stringify(verdict.error?.issues)).toContain("the ceiling of 'log-tail' is 200");
  });

  it("refuses the same verb declared twice — two lists for one verb and no rule which holds", () => {
    const verdict = capabilitiesSchema.safeParse([
      refresh,
      { name: "repo-refresh", checkouts: ["/home/lle/projects/language-learning-ecosystem"] },
    ]);

    expect(verdict.success).toBe(false);
    expect(JSON.stringify(verdict.error?.issues)).toContain("is declared twice");
  });

  it("refuses an empty declaration: the field is left out instead", () => {
    const verdict = capabilitiesSchema.safeParse([]);

    expect(verdict.success).toBe(false);
    expect(JSON.stringify(verdict.error?.issues)).toContain("an empty list is not a declaration");
  });
});

describe("the version this costs, and the tables that record it", () => {
  it("is the version this build writes", () => {
    expect(CURRENT_PROTOCOL_VERSION).toBe(24);
  });

  it("answers a v24 config on a v23 build with 'restart required', not with 'invalid'", () => {
    const verdict = compareProtocolVersion(24, 23);

    expect(verdict.state).toBe("ahead");
    expect(renderVersionVerdict(verdict)).toContain("restart required");
  });

  it("the KEY table gains exactly the paths of the new field and loses none", () => {
    const before = CONFIG_SHAPES[23] ?? [];
    const after = CONFIG_SHAPES[24] ?? [];

    expect(after.filter((row) => !before.includes(row))).toEqual([
      "roles[].capabilities",
      "roles[].capabilities[].checkouts",
      "roles[].capabilities[].logs",
      "roles[].capabilities[].maxLines",
      "roles[].capabilities[].name",
    ]);
    expect(before.filter((row) => !after.includes(row))).toEqual([]);
  });

  it("the VALUE table moves too, one row per verb — the half that was blind on #74", () => {
    const before = CONFIG_VALUES[23] ?? [];
    const after = CONFIG_VALUES[24] ?? [];

    expect(after.filter((row) => !before.includes(row))).toEqual([
      'roles[].capabilities[].name = "disk-free"',
      'roles[].capabilities[].name = "log-tail"',
      'roles[].capabilities[].name = "repo-refresh"',
    ]);
    expect(before.filter((row) => !after.includes(row))).toEqual([]);
  });
});

describe("the step itself", () => {
  it("writes nothing — every config valid at 23 is valid at 24", () => {
    expect(ROLE_CAPABILITIES_STEP.from).toBe(23);
    expect(ROLE_CAPABILITIES_STEP.plan({} as never).files ?? []).toEqual([]);
  });

  it("is registered, so the chain 23 → 24 is planned and not refused as a gap", () => {
    const plan = planMigration({
      declared: 23,
      target: 24,
      context: {
        configPath: "agent-protocol.json",
        config: { protocolVersion: 23, roles: [] },
      } as never,
    });

    expect(plan.steps.map((step) => step.to)).toEqual([24]);
  });
});
