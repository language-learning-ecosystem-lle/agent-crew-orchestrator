/**
 * THE POLICY SHAPE — the fields a door reads about a foreign ref, and nothing else
 * (thread `037-zones-door-version-gate`).
 *
 * The process test of the door (`roles/zones.process.test.ts`) proves the verdict end
 * to end; these are the four statements the shape itself makes, kept where they can be
 * read in one screen.
 */
import { describe, expect, it } from "vitest";

import { pathsOutsideZones } from "../roles/zones.js";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { protocolConfigSchema } from "./config.js";
import { describePolicySkew, policyConfigSchema, policyRole } from "./policy.js";

/** A config at a shape THIS build does not have: renamed section, missing one, unknown keys. */
const FOREIGN = {
  protocolVersion: CURRENT_PROTOCOL_VERSION + 1,
  post: { branch: "comms", dir: "agent-comms" },
  somethingAddedLater: { deeply: { nested: true } },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
      inventedLater: "x",
      zones: { writes: [], forbidden: ["apps/pronunciation-service"], alsoInvented: 1 },
      instructions: [{ kind: "in-repo", path: "CLAUDE.md", inventedHereToo: true }],
    },
  ],
  orchestrator: {
    state: ".protocol",
    mailCheckout: ".worktrees/comms",
    ref: "origin/main",
    workdir: { branch: "main", worktrees: ".worktrees", inventedLater: 1 },
  },
};

describe("the policy shape of the config", () => {
  it("is the case the strict shape refuses — which is the whole reason it exists", () => {
    // Cases C and D of the diagnosis (thread 037, msg-002): a required section gone and
    // a section renamed both fail in the strict parse BEFORE any version is compared,
    // so `tolerateOlder` could not reach them.
    expect(protocolConfigSchema.safeParse(FOREIGN).success).toBe(false);
  });

  it("reads the three fields a door came for out of that same config", () => {
    const parsed = policyConfigSchema.parse(FOREIGN);
    const role = policyRole(parsed, "dev-core");

    expect(role?.zones?.forbidden).toEqual(["apps/pronunciation-service"]);
    expect(role?.instructions?.map((doc) => doc.path)).toEqual(["CLAUDE.md"]);
    expect(parsed.orchestrator?.workdir?.worktrees).toBe(".worktrees");
  });

  it("gives the zone verdict the current shape would give — the acceptance criterion", () => {
    const foreign = policyRole(policyConfigSchema.parse(FOREIGN), "dev-core");
    const paths = ["apps/pronunciation-service/main.py", "packages/agent-protocol/src/cli.ts"];

    expect(pathsOutsideZones({ role: foreign as { id: string }, paths })).toEqual([
      "apps/pronunciation-service/main.py",
    ]);
  });

  it("still refuses BY DATA when the field it came for is gone", () => {
    const { roles: _moved, ...withoutRoles } = FOREIGN;

    const result = policyConfigSchema.safeParse({ ...withoutRoles, participants: FOREIGN.roles });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain("roles");
  });

  it("says the skew in both directions and says nothing when the shapes match", () => {
    const supported = CURRENT_PROTOCOL_VERSION;
    const line = (declared: number): string | undefined =>
      describePolicySkew({
        ref: "origin/main",
        version: {
          state: declared === supported ? "current" : declared < supported ? "behind" : "ahead",
          declared,
          supported,
        },
      });

    expect(line(supported)).toBeUndefined();
    expect(line(supported - 1)).toContain(`declares protocol version ${supported - 1}`);
    expect(line(supported + 1)).toContain(`declares protocol version ${supported + 1}`);
  });
});
