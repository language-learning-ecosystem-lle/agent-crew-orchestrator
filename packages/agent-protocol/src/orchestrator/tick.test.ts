import { describe, expect, it } from "vitest";
import type { OrchestratorEvent } from "./journal.js";
import { MAX_CONSECUTIVE_RUNS } from "./launch.js";
import { type Candidate, describePlan, describeSkip, planTick, type TickDecision } from "./tick.js";

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

/** What the tick would actually raise, as `role×thread` — the plan, not its wrapper. */
const raised = (decision: TickDecision): readonly string[] =>
  decision.kind === "plan" ? decision.launches.map((c) => `${c.role}×${c.thread}`) : [];

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
      kind: "plan",
      launches: [{ role: "dev-core", thread: "t1" }],
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
      kind: "plan",
      launches: [{ role: "dev-core", thread: "free" }],
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
      kind: "plan",
      launches: [{ role: "dev-speech", thread: "t2" }],
      skipped: [{ role: "dev-core", thread: "t1", reason: "held", attempt: 0 }],
    });
  });

  it("the stop flag beats a hold — the emergency brake argues with nothing", () => {
    expect(planTick({ ...base, enabled: true, stopped: true, held: ["dev-core"] }).kind).toBe(
      "halt",
    );
  });

  it("without holds the behaviour is unchanged", () => {
    expect(raised(planTick({ ...base, enabled: true, stopped: false, held: [] }))).toEqual([
      "dev-core×t1",
    ]);
  });
});

describe("planTick — the global ceiling with a trace (requirement 1)", () => {
  it("the ceiling is exhausted → refused run-budget (not launch)", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_CONSECUTIVE_RUNS; i += 1) events.push(launch("x", `t${i}`));
    expect(planTick({ ...base, events, enabled: true, stopped: false })).toEqual({
      kind: "plan",
      launches: [],
      cut: {
        reason: "run-budget",
        candidates: [{ role: "dev-core", thread: "t1" }],
        recorded: { role: "dev-core", thread: "t1" },
      },
      skipped: [],
    });
  });

  it("completed resets the counter → launch again", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_CONSECUTIVE_RUNS; i += 1) events.push(launch("x", `t${i}`));
    events.push(released("x", "t0", "completed"));
    expect(raised(planTick({ ...base, events, enabled: true, stopped: false }))).toEqual([
      "dev-core×t1",
    ]);
  });

  it("the ceiling is calibratable", () => {
    const events = [launch("x", "1"), launch("x", "2")];
    expect(
      raised(planTick({ ...base, events, enabled: true, stopped: false, maxConsecutive: 2 })),
    ).toEqual([]);
    expect(
      raised(planTick({ ...base, events, enabled: true, stopped: false, maxConsecutive: 5 })),
    ).toEqual(["dev-core×t1"]);
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
    expect(raised(decision)).toEqual(["dev-core×t1"]);
    expect(decision.skipped).toEqual([]);
  });

  it("a delivery in the middle un-exhausts the pair — it is launched, not skipped", () => {
    const events = exhaustedEvents();
    events.push(released("dev-core", "t1", "completed"));
    expect(raised(planTick({ ...base, events, enabled: true, stopped: false }))).toEqual([
      "dev-core×t1",
    ]);
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
    expect(raised(decision)).toEqual(["dev-core×free"]);
    expect(decision.skipped).toEqual([
      { role: "dev-speech", thread: "busy", reason: "active", attempt: 1 },
    ]);
  });
});

describe("planTick — one launch per FREE ROLE, not one per box (D-1, thread 023)", () => {
  // The picture john named as the thing to remove: dev-core works 016 while the curator
  // workspace idles on a waiting 019. The degree of parallelism is the number of free
  // roles, and that is decided HERE, in one pass over one reading of the journal.
  it("every free role gets its own pair in one plan", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "016" },
      { role: "curator", thread: "019" },
      { role: "dev-speech", thread: "021" },
    ];
    const decision = planTick({ ...base, candidates, enabled: true, stopped: false });
    expect(raised(decision)).toEqual(["dev-core×016", "curator×019", "dev-speech×021"]);
    expect(decision.skipped).toEqual([]);
  });

  it("a role is planned ONCE — its second thread comes back as role-busy, not as silence", () => {
    // Under a scalar `waiting-on` (024) one role is routinely awaited by several threads,
    // so this is the ordinary shape of the queue. Before D-1 the pairs behind the chosen
    // one left no line at all: the operator saw a queue of three and one launch.
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "016" },
      { role: "dev-core", thread: "023" },
      { role: "curator", thread: "019" },
    ];
    const decision = planTick({ ...base, candidates, enabled: true, stopped: false });
    expect(raised(decision)).toEqual(["dev-core×016", "curator×019"]);
    expect(decision.skipped).toEqual([
      { role: "dev-core", thread: "023", reason: "role-busy", attempt: 0 },
    ]);
  });

  it("the queue order decides WHICH thread a role gets — the head of its own tier", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "older" },
      { role: "dev-core", thread: "newer" },
    ];
    expect(raised(planTick({ ...base, candidates, enabled: true, stopped: false }))).toEqual([
      "dev-core×older",
    ]);
  });

  it("a busy role does not cost the others their launch", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "busy" },
      { role: "curator", thread: "019" },
    ];
    const decision = planTick({
      ...base,
      candidates,
      events: [acquire("dev-core", "busy")],
      enabled: true,
      stopped: false,
    });
    expect(raised(decision)).toEqual(["curator×019"]);
    expect(decision.skipped).toEqual([
      { role: "dev-core", thread: "busy", reason: "active", attempt: 1 },
    ]);
  });
});

describe("planTick — a role this process is ALREADY running (D-2, thread 023)", () => {
  // The registry of live supervisors is what the non-blocking tick added, and this is the
  // only place its knowledge enters a decision. It cannot be derived from the journal in
  // time: the lease is written by the supervisor, and a tick landing between the plan and
  // that write would put a second session into a live workspace.
  it("a running role is not planned again, and its pair is named, not dropped", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "023" },
      { role: "curator", thread: "019" },
    ];
    const decision = planTick({
      ...base,
      candidates,
      running: ["dev-core"],
      enabled: true,
      stopped: false,
    });
    expect(raised(decision)).toEqual(["curator×019"]);
    expect(decision.skipped).toEqual([
      { role: "dev-core", thread: "023", reason: "role-busy", attempt: 0 },
    ]);
  });

  it("it holds ACROSS threads — a running role is busy for every thread waiting on it", () => {
    // The pair the supervisor is running need not be the pair that comes up next: under a
    // scalar `waiting-on` (024) the same role is routinely awaited by several threads, and
    // the workspace it would need is the one already occupied.
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "016" },
      { role: "dev-core", thread: "035" },
    ];
    const decision = planTick({
      ...base,
      candidates,
      running: ["dev-core"],
      enabled: true,
      stopped: false,
    });
    expect(decision.kind).toBe("idle");
    expect(decision.skipped.map((s) => s.reason)).toEqual(["role-busy", "role-busy"]);
  });

  it("running roles cost nobody else their launch — the point of the exercise", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "023" },
      { role: "curator", thread: "019" },
      { role: "dev-speech", thread: "021" },
    ];
    expect(
      raised(
        planTick({ ...base, candidates, running: ["dev-core"], enabled: true, stopped: false }),
      ),
    ).toEqual(["curator×019", "dev-speech×021"]);
  });

  it("an empty registry changes nothing — the pre-D-2 plan, verbatim", () => {
    const candidates: Candidate[] = [{ role: "dev-core", thread: "023" }];
    expect(
      raised(planTick({ ...base, candidates, running: [], enabled: true, stopped: false })),
    ).toEqual(["dev-core×023"]);
  });
});

describe("planTick — the global budget CUTS THE TAIL of the plan (D-1)", () => {
  const threeRoles: Candidate[] = [
    { role: "dev-core", thread: "016" },
    { role: "curator", thread: "019" },
    { role: "dev-speech", thread: "021" },
  ];

  it("a remainder of one lets the head through and cuts the rest — with ONE reason", () => {
    // A budget is a count of launches, so a plan of three spends three of it. Read once
    // per tick: the remainder takes the head, the rest is cut.
    const events = [launch("x", "1"), launch("x", "2")];
    const decision = planTick({
      ...base,
      candidates: threeRoles,
      events,
      enabled: true,
      stopped: false,
      maxConsecutive: 3,
    });
    expect(raised(decision)).toEqual(["dev-core×016"]);
    expect(decision.kind === "plan" ? decision.cut : undefined).toEqual({
      reason: "run-budget",
      candidates: [
        { role: "curator", thread: "019" },
        { role: "dev-speech", thread: "021" },
      ],
      recorded: { role: "curator", thread: "019" },
    });
  });

  it("ONE record for the whole cut: the pair it is written against is the head of the tail", () => {
    // The alternative — a `launch-refused` per cut pair — says the same sentence about one
    // ceiling N times, and buries the journal of the runs under the daemon's complaints.
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_CONSECUTIVE_RUNS; i += 1) events.push(launch("x", `t${i}`));
    const decision = planTick({
      ...base,
      candidates: threeRoles,
      events,
      enabled: true,
      stopped: false,
    });
    expect(raised(decision)).toEqual([]);
    const cut = decision.kind === "plan" ? decision.cut : undefined;
    expect(cut?.candidates).toHaveLength(3);
    expect(cut?.recorded).toEqual({ role: "dev-core", thread: "016" });
  });

  it("a plan that fits leaves no cut at all", () => {
    const decision = planTick({
      ...base,
      candidates: threeRoles,
      enabled: true,
      stopped: false,
      maxConsecutive: 10,
    });
    expect(decision.kind === "plan" ? decision.cut : "not a plan").toBeUndefined();
  });

  it("nothing eligible → idle, and the budget is never consulted", () => {
    // The budget refuses LAUNCHES. A tick with no eligible pair has none to refuse, and
    // saying `run-budget` there would blame the ceiling for an empty mailbox.
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_CONSECUTIVE_RUNS; i += 1) events.push(launch("x", `t${i}`));
    expect(planTick({ ...base, candidates: [], events, enabled: true, stopped: false })).toEqual({
      kind: "idle",
      skipped: [],
    });
  });
});

describe("describePlan — what the operator reads before the first session starts", () => {
  it("names every pair being raised and how many", () => {
    const lines = describePlan({
      launches: [
        { role: "dev-core", thread: "016" },
        { role: "curator", thread: "019" },
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("2 launches");
    expect(lines[0]).toContain("dev-core×016, curator×019");
  });

  it("the cut names EVERY pair it cut, and says which one the journal records", () => {
    // The single journal record is the point of the cut; without this line an operator
    // reading the journal would see one refusal and never learn the other two existed.
    const lines = describePlan({
      launches: [],
      cut: {
        reason: "run-budget",
        candidates: [
          { role: "curator", thread: "019" },
          { role: "dev-speech", thread: "021" },
        ],
        recorded: { role: "curator", thread: "019" },
      },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("run-budget");
    expect(lines[0]).toContain("curator×019, dev-speech×021");
    expect(lines[0]).toContain("curator/019");
  });

  it("an empty plan says nothing — a tick with no launches has its own lines", () => {
    expect(describePlan({ launches: [] })).toEqual([]);
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

  it("role-busy says the pair is not lost — it is first in line next tick", () => {
    const line = describeSkip({ ...skip, reason: "role-busy" }, { value: 3, source: "default" });
    expect(line).toContain("already has a session");
    // BOTH SOURCES OF BUSY-NESS ARE NAMED (D-2): an operator reading this line has to be
    // able to tell "the plan of this tick took the role" from "a supervisor raised half
    // an hour ago is still holding it" — the first resolves itself in seconds, the second
    // lasts as long as a session.
    expect(line).toContain("still running from an earlier one");
    expect(line).toContain("next tick");
  });

  it("a parked pair asks for an ANSWER, and does not read as a working session", () => {
    // The one skip line that calls for an action: "running right now" would tell the
    // operator to do nothing, and the parked session would then die on its wait ceiling.
    const line = describeSkip({ ...skip, reason: "waiting" }, { value: 3, source: "default" });
    expect(line).toContain("ANSWER");
    expect(line).not.toContain("running right now");
  });
});

describe("planTick — the turn parked behind a person (R27)", () => {
  const parked = new Map([["t1", "john"]]);

  it("a parked pair is not raised, and the skip names whose decision it waits for", () => {
    const decision = planTick({ ...base, enabled: true, stopped: false, parked });
    expect(raised(decision)).toEqual([]);
    expect(decision.skipped).toEqual([
      { role: "dev-core", thread: "t1", reason: "parked", attempt: 0, parkedOn: "john" },
    ]);
    expect(
      describeSkip(
        { role: "dev-core", thread: "t1", reason: "parked", attempt: 0, parkedOn: "john" },
        { value: 3, source: "default" },
      ),
    ).toContain("john");
  });

  it("the freeze costs NOTHING: no launch, so the attempt counter stands still", () => {
    // The whole point of the state — three raises against an unanswered question used to
    // exhaust the pair for obeying the norm.
    const events = [acquire("dev-core", "t1"), released("dev-core", "t1", "timeout")];
    const before = planTick({ ...base, events, enabled: true, stopped: false });
    const after = planTick({ ...base, events, enabled: true, stopped: false, parked });
    expect(raised(before)).toEqual(["dev-core×t1"]);
    expect(raised(after)).toEqual([]);
    expect(after.skipped[0]?.attempt).toBe(1);
  });

  it("it outranks 'exhausted' — the pair is described by what blocks it, not by the damage", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < 3; i += 1) {
      events.push(acquire("dev-core", "t1"), released("dev-core", "t1", "timeout"));
    }
    expect(planTick({ ...base, events, enabled: true, stopped: false }).skipped[0]?.reason).toBe(
      "exhausted",
    );
    expect(
      planTick({ ...base, events, enabled: true, stopped: false, parked }).skipped[0]?.reason,
    ).toBe("parked");
  });

  it("a LIVE session outranks the park — a running pair is a fact about now", () => {
    const decision = planTick({
      ...base,
      events: [acquire("dev-core", "t1")],
      enabled: true,
      stopped: false,
      parked,
    });
    expect(decision.skipped[0]?.reason).toBe("active");
  });

  it("only the parked thread drops out: another thread of the same role is raised", () => {
    const decision = planTick({
      ...base,
      candidates: [
        { role: "dev-core", thread: "t1" },
        { role: "dev-core", thread: "t2" },
      ],
      enabled: true,
      stopped: false,
      parked,
    });
    expect(raised(decision)).toEqual(["dev-core×t2"]);
  });
});

/**
 * D-3 PART 2 — THE BACKOFF, tested as a CONTROL PAIR rather than by construction
 * (curator's acceptance (а)): the same tick, the same candidates, the only difference
 * being the quota signal in the journal.
 */
describe("planTick — the closed window stands the box down (D-3 part 2)", () => {
  const quotaSignal = (extra: Record<string, unknown>): OrchestratorEvent =>
    ({
      kind: "lease-released",
      ts: "2026-07-24T13:50:00Z",
      role: "dev-core",
      thread: "t9",
      reason: "quota-exhausted",
      ...extra,
    }) as OrchestratorEvent;

  const two: Candidate[] = [
    { role: "dev-core", thread: "t1" },
    { role: "curator", thread: "t2" },
  ];

  it("WITHOUT the signal the pair is raised — the control", () => {
    const decision = planTick({ ...base, candidates: two, enabled: true, stopped: false });
    expect(raised(decision)).toEqual(["dev-core×t1", "curator×t2"]);
  });

  it("WITH it nobody is raised, and the state is not `idle`", () => {
    const decision = planTick({
      ...base,
      candidates: two,
      events: [quotaSignal({ until: "2026-07-24T16:00:00Z", window: "five_hour" })],
      enabled: true,
      stopped: false,
    });
    expect(decision.kind).toBe("quota");
    expect(raised(decision)).toEqual([]);
    expect(decision.skipped.map((s) => s.reason)).toEqual(["quota", "quota"]);
  });

  it("AFTER `until` the pair is raised again — a backoff that never ends is `exhausted` renamed", () => {
    const decision = planTick({
      ...base,
      candidates: two,
      events: [quotaSignal({ until: "2026-07-24T13:59:00Z", window: "five_hour" })],
      now: NOW,
      enabled: true,
      stopped: false,
    });
    expect(raised(decision)).toEqual(["dev-core×t1", "curator×t2"]);
  });

  it("THE WINDOW IS THE ACCOUNT'S: a signal on one role stands EVERY role down", () => {
    const decision = planTick({
      ...base,
      candidates: two,
      events: [quotaSignal({ until: "2026-07-24T16:00:00Z", window: "five_hour" })],
      enabled: true,
      stopped: false,
    });
    expect(decision.skipped.map((s) => s.role)).toEqual(["dev-core", "curator"]);
  });

  it("one shelf, ONE journal record: the cut appears once and not on the next tick", () => {
    const signal = quotaSignal({ until: "2026-07-24T16:00:00Z", window: "five_hour" });
    const first = planTick({
      ...base,
      candidates: two,
      events: [signal],
      enabled: true,
      stopped: false,
    });
    expect(first.kind === "quota" && first.cut?.reason).toBe("quota");
    const refused: OrchestratorEvent = {
      kind: "launch-refused",
      ts: "2026-07-24T13:51:00Z",
      role: "dev-core",
      thread: "t1",
      reason: "quota",
    };
    const second = planTick({
      ...base,
      candidates: two,
      events: [signal, refused],
      enabled: true,
      stopped: false,
    });
    expect(second.kind).toBe("quota");
    expect(second.kind === "quota" && second.cut).toBeUndefined();
  });

  /**
   * THE UNIT OF THE JOURNAL LINE IS THE DARK SPELL OF THE BOX, NOT THE WINDOW — named
   * out loud by curator's reading of `quotaRefusalRecorded` and pinned here so that it
   * stays a decision instead of a side effect. The line says NOTHING WAS LAUNCHED, which
   * belongs to the box; which windows were closed at that moment is what the shelves say.
   */
  const refusalAt = (ts: string): OrchestratorEvent => ({
    kind: "launch-refused",
    ts,
    role: "dev-core",
    thread: "t1",
    reason: "quota",
  });

  it("two windows closing before the first line share ONE line — the box went dark once", () => {
    const decision = planTick({
      ...base,
      candidates: two,
      events: [
        quotaSignal({ until: "2026-07-24T16:00:00Z", window: "five_hour" }),
        quotaSignal({
          ts: "2026-07-24T13:51:00Z",
          until: "2026-08-04T00:00:00Z",
          window: "seven_day",
        }),
        refusalAt("2026-07-24T13:52:00Z"),
      ],
      enabled: true,
      stopped: false,
    });
    expect(decision.kind === "quota" && decision.shelves.map((s) => s.window)).toEqual([
      "five_hour",
      "seven_day",
    ]);
    expect(decision.kind === "quota" && decision.cut).toBeUndefined();
  });

  it("a window closing AFTER the last line opens a new one — a second dark spell is not silent", () => {
    const decision = planTick({
      ...base,
      candidates: two,
      events: [
        quotaSignal({ until: "2026-07-24T16:00:00Z", window: "five_hour" }),
        refusalAt("2026-07-24T13:51:00Z"),
        quotaSignal({
          ts: "2026-07-24T13:52:00Z",
          until: "2026-08-04T00:00:00Z",
          window: "seven_day",
        }),
      ],
      enabled: true,
      stopped: false,
    });
    expect(decision.kind === "quota" && decision.cut?.reason).toBe("quota");
  });

  it("the skip is SPOKEN, with the reason — silence is the failure this closes", () => {
    const line = describeSkip(
      { role: "dev-core", thread: "t1", reason: "quota", attempt: 0 },
      { value: MAX_CONSECUTIVE_RUNS, source: "default" },
    );
    expect(line).toContain("rate-limit window is closed");
    expect(line).toContain("ACCOUNT");
  });

  it("a HELD role keeps its own reason — quota does not swallow the pair-level ones", () => {
    const decision = planTick({
      ...base,
      candidates: two,
      held: ["dev-core"],
      events: [quotaSignal({ until: "2026-07-24T16:00:00Z", window: "five_hour" })],
      enabled: true,
      stopped: false,
    });
    expect(decision.skipped.map((s) => [s.role, s.reason])).toEqual([
      ["dev-core", "held"],
      ["curator", "quota"],
    ]);
  });
});
