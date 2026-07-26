import { describe, expect, it } from "vitest";
import type { OrchestratorEvent } from "./journal.js";
import { MAX_CONSECUTIVE_RUNS } from "./launch.js";
import { type Candidate, describeSkip, planTick } from "./tick.js";

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
    expect(planTick({ ...base, enabled: true, stopped: true })).toEqual({
      kind: "halt",
      skipped: [],
    });
  });

  it("not enabled → disabled (the starting state is off)", () => {
    expect(planTick({ ...base, enabled: false, stopped: false })).toEqual({
      kind: "disabled",
      skipped: [],
    });
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
      skipped: [],
    });
  });

  it("no candidates → idle", () => {
    expect(planTick({ ...base, candidates: [], enabled: true, stopped: false })).toEqual({
      kind: "idle",
      skipped: [],
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
    ).toEqual({
      kind: "idle",
      skipped: [{ role: "dev-core", thread: "t1", reason: "active", attempt: 1 }],
    });
  });

  it("an exhausted pair → skipped (the attempt ceiling on the thread)", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < 3; i += 1) {
      events.push(acquire("dev-core", "t1"), released("dev-core", "t1", "timeout"));
    }
    expect(planTick({ ...base, events, enabled: true, stopped: false })).toEqual({
      kind: "idle",
      skipped: [{ role: "dev-core", thread: "t1", reason: "exhausted", attempt: 3 }],
    });
  });

  it("A PARKED PAIR IS NOT A CANDIDATE (R19) — its session is alive and about to resume", () => {
    // The dangerous tick: a session waiting for input becomes a candidate the moment
    // the answer arrives (the thread waits on the role again), and its process is still
    // up. Launching there would put a second session of one role on top of a live one.
    const events: OrchestratorEvent[] = [
      acquire("dev-core", "t1"),
      {
        kind: "input-awaited",
        ts: "2026-07-24T13:10:00Z",
        role: "dev-core",
        thread: "t1",
        deadline: "2026-07-24T15:10:00Z",
      },
    ];
    // And it drops out AUDIBLY, with its OWN reason: not a silent disappearance into
    // `idle`, and not `active` either — a parked pair is the only skip that asks a human
    // for something, and the line it produces has to say so.
    expect(planTick({ ...base, events, enabled: true, stopped: false })).toEqual({
      kind: "idle",
      skipped: [{ role: "dev-core", thread: "t1", reason: "waiting", attempt: 1 }],
    });
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
    expect(decision).toEqual({
      kind: "launch",
      role: "dev-core",
      thread: "free",
      skipped: [{ role: "dev-core", thread: "busy", reason: "active", attempt: 1 }],
    });
  });
});

describe("planTick — a hold on a manual session (S5)", () => {
  it("the role is taken by a human → held with its name, not launch", () => {
    expect(planTick({ ...base, enabled: true, stopped: false, held: ["dev-core"] })).toEqual({
      kind: "held",
      roles: ["dev-core"],
      skipped: [{ role: "dev-core", thread: "t1", reason: "held", attempt: 0 }],
    });
  });

  it("no work at all → idle, not held: a hold without mail does not disturb the circuit", () => {
    expect(
      planTick({ ...base, candidates: [], enabled: true, stopped: false, held: ["dev-core"] }),
    ).toEqual({ kind: "idle", skipped: [] });
  });

  it("a hold holds the ROLE, not the pair — it is taken on all of its threads", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "t1" },
      { role: "dev-core", thread: "t2" },
    ];
    expect(
      planTick({ ...base, candidates, enabled: true, stopped: false, held: ["dev-core"] }),
    ).toEqual({
      kind: "held",
      roles: ["dev-core"],
      skipped: [
        { role: "dev-core", thread: "t1", reason: "held", attempt: 0 },
        { role: "dev-core", thread: "t2", reason: "held", attempt: 0 },
      ],
    });
  });

  it("one role is taken — the others launch as usual", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "t1" },
      { role: "dev-speech", thread: "t2" },
    ];
    expect(
      planTick({ ...base, candidates, enabled: true, stopped: false, held: ["dev-core"] }),
    ).toEqual({
      kind: "launch",
      role: "dev-speech",
      thread: "t2",
      skipped: [{ role: "dev-core", thread: "t1", reason: "held", attempt: 0 }],
    });
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
      skipped: [],
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

describe("planTick — nothing drops out silently (the defect of 2026-07-26)", () => {
  // The daemon printed its banner and exited without a word: the only candidate was
  // exhausted, the tick said `idle`, and `idle` said nothing at all. From the outside
  // that is indistinguishable from an empty mailbox.
  const exhaustedEvents = (): OrchestratorEvent[] => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < 3; i += 1) {
      events.push(acquire("dev-core", "t1"), released("dev-core", "t1", "timeout"));
    }
    return events;
  };

  it("an exhausted candidate comes back as a skip with its reason and its count", () => {
    const decision = planTick({
      ...base,
      events: exhaustedEvents(),
      enabled: true,
      stopped: false,
    });
    expect(decision.skipped).toEqual([
      { role: "dev-core", thread: "t1", reason: "exhausted", attempt: 3 },
    ]);
  });

  it("the ceiling reaches the skip: the same journal, a laxer ceiling → a launch", () => {
    const decision = planTick({
      ...base,
      events: exhaustedEvents(),
      enabled: true,
      stopped: false,
      maxAttempts: 5,
    });
    expect(decision).toMatchObject({ kind: "launch", role: "dev-core", thread: "t1" });
    expect(decision.skipped).toEqual([]);
  });

  it("a delivery in the middle un-exhausts the pair — it is launched, not skipped", () => {
    const events = exhaustedEvents();
    events.push(released("dev-core", "t1", "completed"));
    expect(planTick({ ...base, events, enabled: true, stopped: false }).kind).toBe("launch");
  });

  it("candidates BEHIND the launched one are still accounted for", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "free" },
      { role: "dev-speech", thread: "busy" },
    ];
    const decision = planTick({
      ...base,
      candidates,
      events: [acquire("dev-speech", "busy")],
      enabled: true,
      stopped: false,
    });
    expect(decision).toMatchObject({ kind: "launch", thread: "free" });
    expect(decision.skipped).toEqual([
      { role: "dev-speech", thread: "busy", reason: "active", attempt: 1 },
    ]);
  });
});

describe("describeSkip — the line an operator reads", () => {
  const skip = { role: "dev-core", thread: "016", attempt: 13 } as const;

  it("exhausted names the count, the ceiling AND where the ceiling came from", () => {
    const line = describeSkip({ ...skip, reason: "exhausted" }, { value: 3, source: "default" });
    expect(line).toContain("dev-core×016");
    expect(line).toContain("exhausted");
    expect(line).toContain("13 failed attempts");
    expect(line).toContain("ceiling 3 (default)");
  });

  it("a flag is reported as a flag — an ignored flag was the whole defect", () => {
    expect(describeSkip({ ...skip, reason: "exhausted" }, { value: 20, source: "flag" })).toContain(
      "ceiling 20 (flag)",
    );
  });

  it("held and active name themselves", () => {
    expect(describeSkip({ ...skip, reason: "held" }, { value: 3, source: "default" })).toContain(
      "manual session",
    );
    expect(describeSkip({ ...skip, reason: "active" }, { value: 3, source: "default" })).toContain(
      "running right now",
    );
  });

  it("a parked pair asks for an ANSWER, and does not read as a working session", () => {
    // The one skip line that calls for an action: "running right now" would tell the
    // operator to do nothing, and the parked session would then die on its wait ceiling.
    const line = describeSkip({ ...skip, reason: "waiting" }, { value: 3, source: "default" });
    expect(line).toContain("ANSWER");
    expect(line).not.toContain("running right now");
  });
});
