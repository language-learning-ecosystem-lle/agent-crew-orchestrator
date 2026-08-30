/**
 * THE SURFACE OF A CALL, tested where it must not act. The door's tests (`capability-call.test.ts`)
 * cover what a call resolves to; these cover what the surface DOES with the resolution, and the
 * three facts that make it safe are all negative ones — without `--write` the runner is never
 * called, a dirty checkout is never repaired, and a failed first step is never followed by a
 * second. A negative fact cannot be shown by an output that "looks like a plan": every one of them
 * is asserted on the injected world (was the runner called at all, with what) rather than on text.
 *
 * The integration half is at the bottom: the three verbs really run — a `tail` of a temporary file,
 * a `git pull --ff-only` in a temporary clone, a `df`. What is NOT covered is named there in words.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CapabilityCall, CapabilityStep } from "./capability-call.js";
import { type CheckoutState, runCapabilityCall, type StepOutcome } from "./capability-run.js";
import { type Role, roleSchema } from "./schema.js";

const LOG = "/var/log/aco/daemon.log";
const CHECKOUT = "/home/lle/projects/agent-crew-orchestrator";

const devops = (): Role =>
  roleSchema.parse({
    id: "devops",
    kind: "claude-code",
    status: "planned",
    wake: { mode: "watch", session: "crew-devops" },
    summary: "operational role of the box",
    capabilities: [
      { name: "log-tail", logs: [LOG], maxLines: 200 },
      { name: "repo-refresh", checkouts: [CHECKOUT] },
      { name: "disk-free" },
    ],
  });

/** The injected world, and every call it received — the assertions below are about THIS. */
const world = (options?: {
  readonly outcomes?: readonly StepOutcome[];
  readonly checkout?: CheckoutState;
}) => {
  const ran: CapabilityStep[] = [];
  const traces: string[] = [];
  const asked: string[] = [];
  let index = 0;
  return {
    ran,
    traces,
    asked,
    run: (step: CapabilityStep): StepOutcome => {
      ran.push(step);
      const outcome = options?.outcomes?.[index] ?? { code: 0 };
      index += 1;
      return outcome;
    },
    checkoutState: (checkout: string): CheckoutState => {
      asked.push(checkout);
      return options?.checkout ?? { kind: "clean" };
    },
    trace: (line: string): void => {
      traces.push(line);
    },
  };
};

const call = (input: {
  readonly call: CapabilityCall;
  readonly write?: boolean;
  readonly outcomes?: readonly StepOutcome[];
  readonly checkout?: CheckoutState;
  readonly role?: Role;
}) => {
  const w = world({
    ...(input.outcomes === undefined ? {} : { outcomes: input.outcomes }),
    ...(input.checkout === undefined ? {} : { checkout: input.checkout }),
  });
  const outcome = runCapabilityCall({
    role: input.role ?? devops(),
    call: input.call,
    write: input.write ?? false,
    run: w.run,
    checkoutState: w.checkoutState,
    trace: w.trace,
    by: "aco-devops",
    at: "2026-08-30T12:00:00Z",
  });
  return { ...w, outcome };
};

describe("the refusal of the door travels through the surface verbatim", () => {
  it("prints the door's words whole, and runs nothing", () => {
    const { outcome, ran } = call({ call: { name: "service-restart" } });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // Not a paraphrase and not a code: the vocabulary, the repair and the file to edit.
    expect(outcome.refusal).toContain("does not declare the capability 'service-restart'");
    expect(outcome.refusal).toContain("'log-tail'");
    expect(outcome.refusal).toContain("agent-protocol.json");
    expect(ran).toEqual([]);
  });

  it("carries the ceiling refusal, not a trimmed tail", () => {
    const { outcome, ran } = call({ call: { name: "log-tail", target: LOG, lines: 5000 } });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toContain("refused rather than trimmed");
    expect(ran).toEqual([]);
  });
});

describe("--write is the whole difference for a call that changes the box", () => {
  it("without it the runner is NOT CALLED — asserted on the world, not on the text", () => {
    const { outcome, ran, asked, traces } = call({
      call: { name: "repo-refresh", target: CHECKOUT },
    });
    expect(ran).toEqual([]);
    // Nor is the checkout even looked at: a plan does not touch the tree in any way.
    expect(asked).toEqual([]);
    expect(traces).toEqual([]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.ran).toBe(false);
    expect(outcome.traced).toBe(false);
    const report = outcome.report.join("\n");
    expect(report).toContain("git -C /home/lle/projects/agent-crew-orchestrator pull --ff-only");
    expect(report).toContain("--write");
  });

  it("with it both steps run, in order", () => {
    const { outcome, ran } = call({
      call: { name: "repo-refresh", target: CHECKOUT },
      write: true,
    });
    expect(ran.map((s) => [s.command, ...s.argv].join(" "))).toEqual([
      `git -C ${CHECKOUT} pull --ff-only`,
      `pnpm --dir ${CHECKOUT} install`,
    ]);
    expect(outcome.ok).toBe(true);
  });

  it("a read needs no --write: it runs as it is", () => {
    const { outcome, ran, traces } = call({ call: { name: "disk-free" } });
    expect(ran.map((s) => [s.command, ...s.argv].join(" "))).toEqual(["df -h"]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.ran).toBe(true);
    // A read changes nothing, so it leaves no trace — and the outcome SAYS so, so that a caller
    // cannot print "trace: <path>" about a file holding nothing of this call.
    expect(outcome.traced).toBe(false);
    expect(traces).toEqual([]);
  });
});

describe("a dirty checkout is refused by name, never repaired", () => {
  it("names the entries and does not run a single step", () => {
    const { outcome, ran } = call({
      call: { name: "repo-refresh", target: CHECKOUT },
      write: true,
      checkout: { kind: "dirty", entries: [" M packages/agent-protocol/src/cli.ts"] },
    });
    expect(ran).toEqual([]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toContain("uncommitted work");
    expect(outcome.refusal).toContain("packages/agent-protocol/src/cli.ts");
    expect(outcome.refusal).toContain("does not repair somebody else's tree");
    // The repair is addressed to a hand, and it is not "we will stash it for you".
    expect(outcome.refusal).toContain("by hand");
  });

  it("a checkout whose state cannot be read is not treated as a clean one", () => {
    const { outcome, ran } = call({
      call: { name: "repo-refresh", target: CHECKOUT },
      write: true,
      checkout: { kind: "unreadable", detail: "not a git repository" },
    });
    expect(ran).toEqual([]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toContain("could not be read");
    expect(outcome.refusal).toContain("not a git repository");
  });
});

describe("an outcome does not pretend to be a success", () => {
  it("a failed first step names the step, the command and the code — and stops the second", () => {
    const { outcome, ran } = call({
      call: { name: "repo-refresh", target: CHECKOUT },
      write: true,
      outcomes: [{ code: 128 }],
    });
    expect(ran).toHaveLength(1);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toContain("step 1 of 2");
    expect(outcome.refusal).toContain(`git -C ${CHECKOUT} pull --ff-only`);
    expect(outcome.refusal).toContain("exit code 128");
    expect(outcome.refusal).toContain("did NOT run");
    expect(outcome.refusal).toContain(`pnpm --dir ${CHECKOUT} install`);
  });

  it("a step that could not be run at all says so, instead of reporting a code", () => {
    const { outcome } = call({
      call: { name: "disk-free" },
      outcomes: [{ code: -1, error: "spawn df ENOENT" }],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toContain("could not be run at all");
    expect(outcome.refusal).toContain("spawn df ENOENT");
  });

  it("a failed state-changing call still leaves a trace, and it says it failed", () => {
    const { traces } = call({
      call: { name: "repo-refresh", target: CHECKOUT },
      write: true,
      outcomes: [{ code: 1 }],
    });
    expect(traces).toHaveLength(1);
    expect(traces[0]).toContain("FAILED at step 1 of 2");
    expect(traces[0]).toContain("by aco-devops");
  });
});

describe("the trace an outsider reads without the transcript", () => {
  it("holds the four facts: when, by whom, which call with which values, how it ended", () => {
    const { traces } = call({
      call: { name: "repo-refresh", target: CHECKOUT },
      write: true,
    });
    expect(traces).toHaveLength(1);
    const line = traces[0] as string;
    expect(line).toContain("2026-08-30T12:00:00Z");
    expect(line).toContain("by aco-devops");
    expect(line).toContain("capability repo-refresh");
    expect(line).toContain("role devops");
    expect(line).toContain(`target ${CHECKOUT}`);
    expect(line).toContain("changes state");
    // Every command that ran, verbatim — the same values the steps were built from.
    expect(line).toContain(`git -C ${CHECKOUT} pull --ff-only`);
    expect(line).toContain(`pnpm --dir ${CHECKOUT} install`);
    expect(line).toContain("outcome ok");
  });

  it("a read leaves none — the obligation is carried by 'changesState', not by memory", () => {
    const { traces } = call({ call: { name: "log-tail", target: LOG, lines: 10 } });
    expect(traces).toEqual([]);
  });
});

/**
 * THE INTEGRATION HALF — the verbs on the outcome, not on the form. All three run with the rights
 * of an ordinary user, which is why this is possible here and was not for the spawn under a
 * declared user (thread 047: there is no second user in CI).
 *
 * WHAT IS NOT COVERED HERE, said in words rather than shown green: a live call under `aco-devops`
 * (it waits for john's hand on §0.1a of `docs/box-setup.md`), the `env_keep` of that rule (nothing
 * on the caller's side can check it), and `pnpm install` as the second step of `repo-refresh` — it
 * would download a network's worth of packages into a temporary clone, so the step is measured for
 * its FORM in the unit half and its outcome is exercised only through the injected runner.
 */
describe("the verbs on the outcome", () => {
  const temporary: string[] = [];
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "capability-run-"));
    temporary.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
  });

  const realRun = (step: CapabilityStep): StepOutcome => {
    try {
      execFileSync(step.command, [...step.argv], { encoding: "utf8", stdio: "pipe" });
      return { code: 0 };
    } catch (error) {
      const status = (error as { status?: number }).status;
      return status === undefined
        ? { code: -1, error: (error as Error).message }
        : { code: status };
    }
  };

  const realCheckout = (checkout: string): CheckoutState => {
    try {
      const said = execFileSync("git", ["-C", checkout, "status", "--porcelain"], {
        encoding: "utf8",
      });
      const entries = said.split("\n").filter((line) => line.trim().length > 0);
      return entries.length === 0 ? { kind: "clean" } : { kind: "dirty", entries };
    } catch (error) {
      return { kind: "unreadable", detail: (error as Error).message };
    }
  };

  const roleFor = (capabilities: unknown): Role =>
    roleSchema.parse({
      id: "devops",
      kind: "claude-code",
      status: "planned",
      wake: { mode: "watch", session: "crew-devops" },
      summary: "operational role of the box",
      capabilities,
    });

  const runReal = (input: {
    readonly role: Role;
    readonly call: CapabilityCall;
    readonly write?: boolean;
  }) => {
    const traces: string[] = [];
    const outcome = runCapabilityCall({
      role: input.role,
      call: input.call,
      write: input.write ?? false,
      run: realRun,
      checkoutState: realCheckout,
      trace: (line) => traces.push(line),
      by: "lle",
      at: "2026-08-30T12:00:00Z",
    });
    return { outcome, traces };
  };

  it("'log-tail' really tails a declared file", () => {
    const dir = scratch();
    const log = join(dir, "daemon.log");
    writeFileSync(log, "one\ntwo\nthree\n", "utf8");
    const role = roleFor([{ name: "log-tail", logs: [log], maxLines: 200 }]);
    const { outcome } = runReal({ role, call: { name: "log-tail", target: log, lines: 2 } });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.ran).toBe(true);
  });

  it("'disk-free' really runs", () => {
    const role = roleFor([{ name: "disk-free" }]);
    const { outcome } = runReal({ role, call: { name: "disk-free" } });
    expect(outcome.ok).toBe(true);
  });

  it("'repo-refresh' on a real dirty clone is refused, and the tree is left as it was", () => {
    const dir = scratch();
    const origin = join(dir, "origin");
    const clone = join(dir, "clone");
    execFileSync("git", ["init", "-q", "--bare", origin]);
    execFileSync("git", ["clone", "-q", origin, clone]);
    execFileSync("git", ["-C", clone, "config", "user.email", "t@example.com"]);
    execFileSync("git", ["-C", clone, "config", "user.name", "t"]);
    writeFileSync(join(clone, "a.txt"), "one\n", "utf8");
    execFileSync("git", ["-C", clone, "add", "a.txt"]);
    execFileSync("git", ["-C", clone, "commit", "-qm", "one"]);
    // The dirt: an uncommitted change somebody else is standing in.
    writeFileSync(join(clone, "a.txt"), "two\n", "utf8");

    const role = roleFor([{ name: "repo-refresh", checkouts: [clone] }]);
    const { outcome, traces } = runReal({
      role,
      call: { name: "repo-refresh", target: clone },
      write: true,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toContain("uncommitted work");
    expect(outcome.refusal).toContain("a.txt");
    // Not repaired: the file still holds what its owner left there, and nothing was traced
    // because nothing was done to the box.
    expect(readFileSync(join(clone, "a.txt"), "utf8")).toBe("two\n");
    expect(traces).toEqual([]);
  });
});
