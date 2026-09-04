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
    const devAcme = { ...devCore, id: "dev-acme" };

    expect(() => registryOf(devCore, devAcme)).toThrow(/share session/);
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

  /**
   * WHO SENDS, NOT WHO SIGNS (thread 072; the boundary widened 2026-09-04). The mail's doors
   * ask for a judgement — what this letter does about the park standing on the thread — and a
   * step of a job has nobody to make one, whatever name it signs with. The line is drawn over
   * `wake` and NEVER over `kind` (a vendor's label this package does not read) and never over
   * the presence of a card: `reviewer-pr` HAS `REVIEWER.md` and is still a step of the review
   * job, which is exactly what the consumer contour's round `33751725081` measured — an
   * `approve` that reached the PR and not the feed.
   */
  it("tells a job step from a raised session: 'event' is the whole predicate, a card does not make an author", () => {
    const notifier = {
      id: "github",
      kind: "gh-action",
      status: "active",
      wake: { mode: "event" },
      summary: "the circuit announcing its own facts",
    };
    const reviewerWithCard = {
      ...reviewer,
      instructions: [{ kind: "in-repo", path: "REVIEWER.md" }],
    };
    const registry = registryOf(john, curator, devCore, reviewerWithCard, notifier);

    expect(registry.isMachineWriter("github")).toBe(true);
    // A CARD DOES NOT MAKE AN AUTHOR: nobody is raised as this participant, so the verdict it
    // signs is written by a workflow step and there is no session to ask about the park.
    expect(registry.isMachineWriter("reviewer-pr")).toBe(true);
    // ...and the same participant WITHOUT a card is no different: the card was never the fact.
    expect(registryOf(john, reviewer).isMachineWriter("reviewer-pr")).toBe(true);
    // REGRESSION, the half the norm keeps: everybody the circuit can raise, and every human,
    // meets the door as before. A card is irrelevant here too — `dev-core` has none in this
    // fixture and is still asked, because a session of ours IS raised as it.
    expect(registry.isMachineWriter("john")).toBe(false);
    expect(registry.isMachineWriter("curator")).toBe(false);
    expect(registry.isMachineWriter("dev-core")).toBe(false);
    expect(
      registryOf(john, { ...devCore, wake: { mode: "resident" } }).isMachineWriter("dev-core"),
    ).toBe(false);
    expect(registry.isMachineWriter("nobody")).toBe(false);
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
      id: "dev-acme",
      status: "paused",
      wake: { mode: "watch", session: "acme-dev-acme" },
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
