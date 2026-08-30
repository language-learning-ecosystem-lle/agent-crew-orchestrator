import { describe, expect, it } from "vitest";

import { parseProtocolConfig } from "../config/config.js";
import { createRoleRegistry, RoleConfigError } from "./registry.js";

const john = {
  id: "john",
  kind: "human",
  status: "active",
  wake: { mode: "self" },
  summary: "PM and owner",
  permissions: ["thread-status"],
};

const curator = {
  id: "curator",
  kind: "claude.ai",
  status: "active",
  wake: { mode: "via-human", via: "john" },
  summary: "PM assistant",
  permissions: ["thread-status"],
};

const devCore = {
  id: "dev-core",
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: "acme-dev-core" },
  summary: "main stream",
};

const reviewer = {
  id: "reviewer-pr",
  kind: "gh-action",
  status: "active",
  wake: { mode: "event" },
  summary: "PR review",
};

const MAIL = { branch: "comms", dir: "agent-comms" };

const registryOf = (...roles: unknown[]) =>
  createRoleRegistry(parseProtocolConfig({ protocolVersion: 1, mail: MAIL, roles }));

describe("loadRoleRegistry", () => {
  it("catches a duplicated role", () => {
    expect(() => registryOf(john, { ...john, summary: "the same one, but different" })).toThrow(
      /declared twice/,
    );
  });

  it("catches a broken wake chain: via points at a non-existent role", () => {
    expect(() => registryOf({ ...curator, wake: { mode: "via-human", via: "jonh" } })).toThrow(
      /the wake chain breaks/,
    );
  });

  it("catches via pointing at a role nobody can wake either", () => {
    // The notification would go to someone who will not see it: "poke the one
    // nobody pokes either" — silence indistinguishable from normal work.
    expect(() =>
      registryOf(devCore, { ...curator, wake: { mode: "via-human", via: "dev-core" } }),
    ).toThrow(/nobody to wake that one/);
  });

  it("catches two roles on one session", () => {
    const devSpeech = { ...devCore, id: "dev-speech" };

    expect(() => registryOf(devCore, devSpeech)).toThrow(/share session/);
  });

  it("lists ALL complaints at once, not the first one encountered", () => {
    try {
      registryOf(john, john, { ...curator, wake: { mode: "via-human", via: "no-such-role" } });
      expect.unreachable("the config must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(RoleConfigError);
      expect((error as RoleConfigError).issues).toHaveLength(2);
    }
  });
});

describe("RoleRegistry", () => {
  it("knows every declared role, retired ones included: old threads reference them", () => {
    const retired = { ...devCore, id: "dev-legacy", status: "retired", wake: { mode: "event" } };
    const registry = registryOf(john, devCore, retired);

    expect(registry.ids()).toEqual(["john", "dev-core", "dev-legacy"]);
    expect(registry.isKnown("dev-legacy")).toBe(true);
    expect(registry.active().map((role) => role.id)).toEqual(["john", "dev-core"]);
  });

  it("grants thread-status rights only to those they were given to", () => {
    const registry = registryOf(john, curator, devCore);

    expect(registry.canEditThreadStatus("john")).toBe(true);
    expect(registry.canEditThreadStatus("curator")).toBe(true);
    expect(registry.canEditThreadStatus("dev-core")).toBe(false);
    expect(registry.canEditThreadStatus("nobody")).toBe(false);
  });

  it("keeps a role nobody wakes out of the domain of the turn (R24)", () => {
    // Derived from `wake`, not declared: whatever else john is, he is the one role
    // the circuit cannot make act, and holding the turn means being made to act.
    // Everybody the circuit CAN raise — by watch, by event, through a human — holds it.
    const registry = registryOf(john, curator, devCore, reviewer);

    expect(registry.canHoldTurn("john")).toBe(false);
    expect(registry.canHoldTurn("curator")).toBe(true);
    expect(registry.canHoldTurn("dev-core")).toBe(true);
    expect(registry.canHoldTurn("reviewer-pr")).toBe(true);
    expect(registry.canHoldTurn("nobody")).toBe(false);
  });

  it("hands the watch-keeper only roles with a session, and only active ones", () => {
    const paused = {
      ...devCore,
      id: "dev-speech",
      status: "paused",
      wake: { mode: "watch", session: "acme-dev-speech" },
    };
    const registry = registryOf(john, curator, devCore, paused, reviewer);

    expect(registry.watchTargets()).toEqual([{ id: "dev-core", session: "acme-dev-core" }]);
  });

  it("hands the notifier a human directly, an assistant through a human, and no agents at all", () => {
    // The difference in wording (thread 008) stops being knowledge inside awk and
    // becomes a consequence of the data: a dev role has a keeper, curator has none.
    const registry = registryOf(john, curator, devCore, reviewer);

    expect(registry.notificationTargets()).toEqual([
      { id: "john", style: "direct" },
      { id: "curator", style: "nudge", nudge: "john" },
    ]);
  });
});
