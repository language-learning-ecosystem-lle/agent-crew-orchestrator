/**
 * THE DOOR OF A CALL, tested where it refuses — because the refusals ARE the feature. A door that
 * lets the three declared verbs through is half of it; the half that matters is that a call which
 * is not in the card comes back with the reason and the repair, and that nothing of the call's own
 * words reaches a command line on the way.
 *
 * Every role below is built by `roleSchema.parse`, not by a cast: a fixture that skipped the
 * schema could declare a card the config could never hold, and a door tested against an impossible
 * card is a door tested against nothing.
 */
import { describe, expect, it } from "vitest";
import {
  type CapabilityCall,
  capabilityParameter,
  resolveCapabilityCall,
} from "./capability-call.js";
import { type Role, roleSchema } from "./schema.js";

const LOG = "/home/lle/projects/agent-crew-orchestrator/.orchestrator/daemon.log";
const CHECKOUT = "/home/lle/projects/agent-crew-orchestrator";

const roleWith = (capabilities: unknown): Role =>
  roleSchema.parse({
    id: "devops",
    kind: "claude-code",
    status: "planned",
    wake: { mode: "watch", session: "crew-devops" },
    summary: "operational role of the box",
    capabilities,
  });

const devops = (): Role =>
  roleWith([
    { name: "log-tail", logs: [LOG], maxLines: 200 },
    { name: "repo-refresh", checkouts: [CHECKOUT] },
    { name: "disk-free" },
  ]);

const resolve = (call: CapabilityCall, role: Role = devops()) =>
  resolveCapabilityCall({ role, call });

describe("a call the card allows", () => {
  it("tails a declared log with the card's ceiling when the caller names no count", () => {
    const resolved = resolve({ name: "log-tail", target: LOG });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.steps).toEqual([{ command: "tail", argv: ["-n", "200", "--", LOG] }]);
    // The option list is ended before the target: a declared value that began with a dash would
    // otherwise be read as a flag of `tail`, which is a verb growing an argument nobody declared.
    expect(resolved.plan.steps[0]?.argv).toContain("--");
    expect(resolved.plan.changesState).toBe(false);
  });

  it("carries the caller's count when it is under the card's ceiling", () => {
    const resolved = resolve({ name: "log-tail", target: LOG, lines: 20 });
    expect(resolved.ok && resolved.plan.steps[0]?.argv).toEqual(["-n", "20", "--", LOG]);
  });

  it("refreshes a declared checkout with BOTH commands of the verb, in order", () => {
    const resolved = resolve({ name: "repo-refresh", target: CHECKOUT });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.steps).toEqual([
      { command: "git", argv: ["-C", CHECKOUT, "pull", "--ff-only"] },
      { command: "pnpm", argv: ["--dir", CHECKOUT, "install"] },
    ]);
    // `--ff-only` is the boundary between a refresh and a merge somebody has to resolve, and
    // there is no `checkout`, `reset`, `rebase` or `push` anywhere in the plan.
    const words = resolved.plan.steps.flatMap((s) => s.argv);
    expect(words).toContain("--ff-only");
    for (const forbidden of ["checkout", "reset", "rebase", "push", "clean"]) {
      expect(words).not.toContain(forbidden);
    }
  });

  it("aims disk-free at nothing at all", () => {
    const resolved = resolve({ name: "disk-free" });
    expect(resolved.ok && resolved.plan.steps).toEqual([{ command: "df", argv: ["-h"] }]);
  });
});

describe("the trace of a call", () => {
  it("marks the one verb that changes the box, and only it", () => {
    expect(resolve({ name: "repo-refresh", target: CHECKOUT }).ok).toBe(true);
    const refresh = resolve({ name: "repo-refresh", target: CHECKOUT });
    const tail = resolve({ name: "log-tail", target: LOG });
    expect(refresh.ok && refresh.plan.changesState).toBe(true);
    expect(refresh.ok && refresh.plan.trace).toContain("changes state");
    expect(tail.ok && tail.plan.changesState).toBe(false);
    expect(tail.ok && tail.plan.trace).toContain("reads only");
  });

  it("names the role, the verb, the target and every command that will run", () => {
    const resolved = resolve({ name: "repo-refresh", target: CHECKOUT });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    for (const part of ["devops", "repo-refresh", CHECKOUT, "git -C", "pnpm --dir"]) {
      expect(resolved.plan.trace).toContain(part);
    }
    // The trace is composed out of the SAME resolved steps, so a plan whose trace describes a
    // command it does not run cannot be assembled — this is the property, not the wording.
    for (const step of resolved.plan.steps) {
      expect(resolved.plan.trace).toContain([step.command, ...step.argv].join(" "));
    }
  });

  it("says '(none)' rather than nothing for a verb that aims at nothing", () => {
    const resolved = resolve({ name: "disk-free" });
    expect(resolved.ok && resolved.plan.trace).toContain("target (none)");
  });
});

describe("refusal one — the capability is not declared", () => {
  it("refuses a verb of the vocabulary the card does not carry, and quotes what it does", () => {
    const role = roleWith([{ name: "disk-free" }]);
    const resolved = resolve({ name: "repo-refresh", target: CHECKOUT }, role);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.refusal).toContain("does not declare the capability 'repo-refresh'");
    expect(resolved.refusal).toContain("'disk-free'");
    expect(resolved.refusal).toContain("agent-protocol.json");
  });

  it("refuses a name that is not a verb at all with the whole vocabulary quoted", () => {
    const resolved = resolve({ name: "service-restart" });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    // `service-restart` was struck from the set on purpose (john, 2026-08-30) — a caller who
    // remembers it has to be told the set, not just "no".
    expect(resolved.refusal).toContain("not a capability of this protocol");
    for (const verb of ["log-tail", "repo-refresh", "disk-free"]) {
      expect(resolved.refusal).toContain(`'${verb}'`);
    }
  });

  it("tells a role that declares nothing from a role that was narrowed", () => {
    const bare = roleSchema.parse({
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "crew-dev-core" },
      summary: "writes the code",
    });
    const resolved = resolve({ name: "disk-free" }, bare);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.refusal).toContain("declares no capabilities at all");
  });
});

describe("refusal two — the call and the verb disagree about the target", () => {
  it("refuses a call that names no target where the verb has one, and quotes the list", () => {
    const resolved = resolve({ name: "log-tail" });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.refusal).toContain("names no target");
    expect(resolved.refusal).toContain(LOG);
  });

  it("refuses a target aimed at the verb that aims at nothing", () => {
    const resolved = resolve({ name: "disk-free", target: "/" });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.refusal).toContain("takes no target");
  });
});

describe("refusal three — the target is outside the closed list", () => {
  it("refuses an undeclared path and quotes the list it is not in", () => {
    const resolved = resolve({ name: "log-tail", target: "/etc/shadow" });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.refusal).toContain("/etc/shadow");
    expect(resolved.refusal).toContain(LOG);
    expect(resolved.refusal).toContain("EQUALITY");
  });

  it("refuses every value that merely RESEMBLES a declared one — membership is equality", () => {
    // Each of these is the same file or the same directory on this box, and each is refused: a
    // door that reasoned about paths would be the access-wearing-a-verb's-name of record 016.
    for (const target of [
      `${LOG}/`,
      `${LOG}/../daemon.log`,
      "./.orchestrator/daemon.log",
      `${LOG} `,
    ]) {
      const resolved = resolve({ name: "log-tail", target });
      expect(resolved.ok, `must refuse ${target}`).toBe(false);
    }
  });

  it("refuses an undeclared checkout even when a declared one is its parent", () => {
    const resolved = resolve({ name: "repo-refresh", target: `${CHECKOUT}/packages` });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.refusal).toContain("may not aim 'repo-refresh'");
  });
});

describe("the ceiling of log-tail", () => {
  it("refuses a count above the card's ceiling instead of trimming it", () => {
    const resolved = resolve({ name: "log-tail", target: LOG, lines: 5000 });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.refusal).toContain("asked 'log-tail' for 5000 lines");
    expect(resolved.refusal).toContain("refused rather than trimmed");
  });

  it("holds the CARD's ceiling, not the protocol's, when the card is narrower", () => {
    const narrow = roleWith([{ name: "log-tail", logs: [LOG], maxLines: 10 }]);
    expect(resolve({ name: "log-tail", target: LOG, lines: 50 }, narrow).ok).toBe(false);
    const allowed = resolve({ name: "log-tail", target: LOG, lines: 10 }, narrow);
    expect(allowed.ok && allowed.plan.steps[0]?.argv).toEqual(["-n", "10", "--", LOG]);
  });

  it("refuses a count that is not a whole number of lines", () => {
    for (const lines of [0, -5, 2.5]) {
      expect(resolve({ name: "log-tail", target: LOG, lines }).ok, `must refuse ${lines}`).toBe(
        false,
      );
    }
  });
});

describe("a declared target this executor cannot read", () => {
  it("refuses a journal-by-unit rather than tailing it as if it were a file", () => {
    const byUnit = roleWith([
      { name: "log-tail", logs: ["aco-orchestrator.service"], maxLines: 50 },
    ]);
    const resolved = resolve({ name: "log-tail", target: "aco-orchestrator.service" }, byUnit);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    // The repair is addressed to the CARD, not to the caller: the caller did everything right.
    expect(resolved.refusal).toContain("this executor reads files");
    expect(resolved.refusal).toContain("journalctl");
  });
});

describe("the shape of the answer", () => {
  it("has no fourth outcome: a refused call carries no plan and no command", () => {
    const resolved = resolve({ name: "log-tail", target: "/etc/shadow" });
    // Pinned on the FORM, not on the words of the refusal: the words can be rewritten, and the
    // property that matters is that a refused call has no half-plan hanging off it for a caller
    // to reach past the `ok` flag and run anyway.
    expect(resolved).not.toHaveProperty("plan");
    expect(Object.keys(resolved).sort()).toEqual(["ok", "refusal"]);
  });

  it("names each verb's closed list, so a refusal can quote the right parameter", () => {
    expect(capabilityParameter("log-tail")).toBe("logs");
    expect(capabilityParameter("repo-refresh")).toBe("checkouts");
    expect(capabilityParameter("disk-free")).toBeUndefined();
  });
});
