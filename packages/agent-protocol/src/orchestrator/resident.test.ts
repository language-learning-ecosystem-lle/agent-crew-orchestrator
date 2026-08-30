import { describe, expect, it } from "vitest";

import { createRoleRegistry } from "../roles/registry.js";
import type { Role } from "../roles/schema.js";
import { roleSchema, wakeSchema } from "../roles/schema.js";
import { roleLaunchability } from "./launch.js";
import { describeResidentWait, renderResidentWaits, residentWaits } from "./resident.js";
import { ownershipIssues } from "./scope.js";

const role = (over: Partial<Role> & Pick<Role, "id" | "wake">): Role =>
  roleSchema.parse({
    kind: "claude-code",
    status: "active",
    summary: "a role",
    ...over,
  });

const resident = (id: string) => role({ id, wake: { mode: "resident" } });

describe("the role hosted by a live process (R23-1)", () => {
  it("'resident' is a wake mode of its own, and it carries no fields", () => {
    expect(wakeSchema.parse({ mode: "resident" })).toEqual({ mode: "resident" });
    // A session name would be a promise the mode cannot keep: nobody wakes a resident,
    // so there is nothing for a name to address.
    expect(wakeSchema.safeParse({ mode: "resident", session: "acme-curator" }).success).toBe(false);
  });

  it("the circuit refuses to raise it with a reason of its own, not with 'wake-not-watch'", () => {
    expect(roleLaunchability(resident("curator"))).toEqual({
      launchable: false,
      reason: "resident",
    });
    expect(roleLaunchability(role({ id: "john", wake: { mode: "self" } }))).toEqual({
      launchable: false,
      reason: "wake-not-watch",
    });
  });

  it("an inactive resident is reported as inactive: the lifecycle answer comes first", () => {
    expect(
      roleLaunchability(role({ id: "curator", wake: { mode: "resident" }, status: "paused" })),
    ).toEqual({ launchable: false, reason: "inactive" });
  });

  it("it is neither woken nor notified — it is the one participant already reading", () => {
    const registry = createRoleRegistry({
      roles: [
        resident("curator"),
        role({ id: "john", wake: { mode: "self" } }),
        role({ id: "dev-core", wake: { mode: "watch", session: "acme-dev-core" } }),
      ],
    });
    expect(registry.residents()).toEqual(["curator"]);
    expect(registry.watchTargets().map((target) => target.id)).toEqual(["dev-core"]);
    expect(registry.notificationTargets().map((target) => target.id)).toEqual(["john"]);
  });

  it("a retired resident is not listed: `residents()` answers about the live circuit", () => {
    const registry = createRoleRegistry({
      roles: [role({ id: "curator", wake: { mode: "resident" }, status: "retired" })],
    });
    expect(registry.residents()).toEqual([]);
  });

  it("ownership answers for it exactly as for a launchable role — the point of the mode", () => {
    const issues = ownershipIssues({
      instances: [{ id: "main", roles: ["dev-core"] }],
      launchable: ["dev-core"],
      resident: ["curator"],
      isKnownRole: (id) => ["dev-core", "curator"].includes(id),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("'curator' is resident but no instance claims it");
    expect(issues[0]).toContain("HOSTS");
  });

  it("a claimed resident raises nothing, and two claimants are still refused", () => {
    expect(
      ownershipIssues({
        instances: [{ id: "main", roles: ["dev-core", "curator"] }],
        launchable: ["dev-core"],
        resident: ["curator"],
        isKnownRole: () => true,
      }),
    ).toEqual([]);
    const twice = ownershipIssues({
      instances: [
        { id: "main", roles: ["curator"] },
        { id: "spare", roles: ["curator"] },
      ],
      launchable: [],
      resident: ["curator"],
      isKnownRole: () => true,
    });
    expect(twice).toHaveLength(1);
    expect(twice[0]).toContain("EXACTLY ONE instance");
  });
});

describe("a thread waiting on a resident role is visible (R23-1)", () => {
  const waiting = new Map<string, readonly string[]>([
    ["curator", ["016-protocol-roadmap", "020-something"]],
    ["dev-core", ["003-sync-front"]],
  ]);
  const waitingThreads = (role: string) => waiting.get(role) ?? [];

  it("every waiting pair of a resident role comes back, and nobody else's does", () => {
    expect(residentWaits({ residents: ["curator"], waitingThreads })).toEqual([
      { role: "curator", thread: "016-protocol-roadmap" },
      { role: "curator", thread: "020-something" },
    ]);
  });

  it("the daemon's line names the thread, the role and where to look instead", () => {
    const line = describeResidentWait({ role: "curator", thread: "016-protocol-roadmap" });
    expect(line).toContain("016-protocol-roadmap");
    expect(line).toContain("curator");
    expect(line).toContain("RESIDENT");
  });

  it("`status` says 'nobody is waiting' rather than falling silent", () => {
    const rendered = renderResidentWaits({ residents: ["curator"], waits: [] });
    expect(rendered).toContain("curator");
    expect(rendered).toContain("no thread is waiting");
  });

  it("`status` lists the waiting threads when there are any", () => {
    const rendered = renderResidentWaits({
      residents: ["curator"],
      waits: [{ role: "curator", thread: "016-protocol-roadmap" }],
    });
    expect(rendered).toContain("016-protocol-roadmap");
  });

  it("a project with no resident role gets no section at all — there is no question", () => {
    expect(renderResidentWaits({ residents: [], waits: [] })).toBeUndefined();
  });
});
