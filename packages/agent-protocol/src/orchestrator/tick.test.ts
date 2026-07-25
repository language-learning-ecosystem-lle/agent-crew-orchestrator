import { describe, expect, it } from "vitest";
import type { OrchestratorEvent } from "./journal.js";
import { MAX_CONSECUTIVE_RUNS } from "./launch.js";
import { type Candidate, planTick } from "./tick.js";

const NOW = new Date("2026-07-24T14:00:00Z");
const cand: Candidate[] = [{ role: "dev-core", thread: "t1" }];

const acquire = (role: string, thread: string): OrchestratorEvent => ({
  kind: "lease-acquired",
  ts: "2026-07-24T13:00:00Z",
  role,
  thread,
  deadline: "2026-07-24T15:00:00Z",
});
const released = (
  role: string,
  thread: string,
  reason: "completed" | "timeout",
): OrchestratorEvent => ({
  kind: "lease-released",
  ts: "2026-07-24T13:30:00Z",
  role,
  thread,
  reason,
});
const launch = (role: string, thread: string): OrchestratorEvent => ({
  kind: "launch",
  ts: "2026-07-24T13:00:00Z",
  role,
  thread,
});

const base = { events: [] as OrchestratorEvent[], candidates: cand, now: NOW };

describe("planTick — the brake and the off switch (requirements 2, 3)", () => {
  it("the stop flag → halt, even when enabled and with candidates", () => {
    expect(planTick({ ...base, enabled: true, stopped: true })).toEqual({ kind: "halt" });
  });

  it("not enabled → disabled (the starting state is off)", () => {
    expect(planTick({ ...base, enabled: false, stopped: false })).toEqual({ kind: "disabled" });
  });

  it("stop overrides enable", () => {
    expect(planTick({ ...base, enabled: true, stopped: true }).kind).toBe("halt");
  });
});

describe("planTick — launching", () => {
  it("enabled, a fresh candidate → launch the first suitable one", () => {
    expect(planTick({ ...base, enabled: true, stopped: false })).toEqual({
      kind: "launch",
      role: "dev-core",
      thread: "t1",
    });
  });

  it("no candidates → idle", () => {
    expect(planTick({ ...base, candidates: [], enabled: true, stopped: false })).toEqual({
      kind: "idle",
    });
  });

  it("the pair is already running → skipped (idle, if there are no others)", () => {
    expect(
      planTick({
        ...base,
        events: [acquire("dev-core", "t1")],
        enabled: true,
        stopped: false,
      }),
    ).toEqual({ kind: "idle" });
  });

  it("an exhausted pair → skipped (the attempt ceiling on the thread)", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < 3; i += 1) {
      events.push(acquire("dev-core", "t1"), released("dev-core", "t1", "timeout"));
    }
    expect(planTick({ ...base, events, enabled: true, stopped: false })).toEqual({ kind: "idle" });
  });

  it("picks the FIRST suitable one, skipping the active pair", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "busy" },
      { role: "dev-core", thread: "free" },
    ];
    const decision = planTick({
      ...base,
      candidates,
      events: [acquire("dev-core", "busy")],
      enabled: true,
      stopped: false,
    });
    expect(decision).toEqual({ kind: "launch", role: "dev-core", thread: "free" });
  });
});

describe("planTick — a hold on a manual session (S5)", () => {
  it("the role is taken by a human → held with its name, not launch", () => {
    expect(planTick({ ...base, enabled: true, stopped: false, held: ["dev-core"] })).toEqual({
      kind: "held",
      roles: ["dev-core"],
    });
  });

  it("no work at all → idle, not held: a hold without mail does not disturb the circuit", () => {
    expect(
      planTick({ ...base, candidates: [], enabled: true, stopped: false, held: ["dev-core"] }),
    ).toEqual({ kind: "idle" });
  });

  it("a hold holds the ROLE, not the pair — it is taken on all of its threads", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "t1" },
      { role: "dev-core", thread: "t2" },
    ];
    expect(
      planTick({ ...base, candidates, enabled: true, stopped: false, held: ["dev-core"] }),
    ).toEqual({ kind: "held", roles: ["dev-core"] });
  });

  it("one role is taken — the others launch as usual", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "t1" },
      { role: "dev-speech", thread: "t2" },
    ];
    expect(
      planTick({ ...base, candidates, enabled: true, stopped: false, held: ["dev-core"] }),
    ).toEqual({ kind: "launch", role: "dev-speech", thread: "t2" });
  });

  it("the stop flag beats a hold — the emergency brake argues with nothing", () => {
    expect(planTick({ ...base, enabled: true, stopped: true, held: ["dev-core"] }).kind).toBe(
      "halt",
    );
  });

  it("without holds the behaviour is unchanged", () => {
    expect(planTick({ ...base, enabled: true, stopped: false, held: [] }).kind).toBe("launch");
  });
});

describe("planTick — the global ceiling with a trace (requirement 1)", () => {
  it("the ceiling is exhausted → refused run-budget (not launch)", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_CONSECUTIVE_RUNS; i += 1) events.push(launch("x", `t${i}`));
    expect(planTick({ ...base, events, enabled: true, stopped: false })).toEqual({
      kind: "refused",
      role: "dev-core",
      thread: "t1",
      reason: "run-budget",
    });
  });

  it("completed resets the counter → launch again", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_CONSECUTIVE_RUNS; i += 1) events.push(launch("x", `t${i}`));
    events.push(released("x", "t0", "completed"));
    expect(planTick({ ...base, events, enabled: true, stopped: false }).kind).toBe("launch");
  });

  it("the ceiling is calibratable", () => {
    const events = [launch("x", "1"), launch("x", "2")];
    expect(
      planTick({ ...base, events, enabled: true, stopped: false, maxConsecutive: 2 }).kind,
    ).toBe("refused");
    expect(
      planTick({ ...base, events, enabled: true, stopped: false, maxConsecutive: 5 }).kind,
    ).toBe("launch");
  });
});
