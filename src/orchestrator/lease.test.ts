import { describe, expect, it } from "vitest";

import { MAX_ATTEMPTS, type OrchestratorEvent } from "./journal.js";
import { foldLeases, type LeaseView, unclosedLeases } from "./lease.js";

const NOW = new Date("2026-07-24T14:00:00Z");
const PAST = "2026-07-24T13:30:00Z"; // earlier than NOW
const FUTURE = "2026-07-24T15:00:00Z"; // later than NOW

// Event stamps do not matter to the fold (order comes from the journal lines),
// but they must be schema-valid; monotonic ones are issued so they read well.
let clock = 0;
const ts = (): string => {
  clock += 1;
  return `2026-07-24T12:${String(clock).padStart(2, "0")}:00Z`;
};

const acquire = (role: string, thread: string, deadline: string): OrchestratorEvent => ({
  kind: "lease-acquired",
  ts: ts(),
  role,
  thread,
  deadline,
});
const release = (
  role: string,
  thread: string,
  reason:
    | "completed"
    | "forced"
    | "exited-without-handoff"
    | "supervisor-gone"
    | "timeout"
    | "exhausted",
): OrchestratorEvent => ({ kind: "lease-released", ts: ts(), role, thread, reason });
const handoff = (role: string, thread: string): OrchestratorEvent => ({
  kind: "handoff-detected",
  ts: ts(),
  role,
  thread,
});
const launch = (role: string, thread: string): OrchestratorEvent => ({
  kind: "launch",
  ts: ts(),
  role,
  thread,
});
const stop = (role: string, thread: string, mode: "graceful" | "forced"): OrchestratorEvent => ({
  kind: "stop",
  ts: ts(),
  role,
  thread,
  mode,
});

const only = (events: OrchestratorEvent[]): LeaseView => {
  const views = foldLeases(events, NOW);
  expect(views).toHaveLength(1);
  return views[0] as LeaseView;
};

describe("foldLeases — the lifecycle", () => {
  it("taking a lease → running, deadline and attempt are set", () => {
    const v = only([acquire("dev-core", "t", FUTURE)]);
    expect(v).toMatchObject({ state: "running", attempt: 1, deadline: FUTURE, reason: null });
  });

  it("handoff → draining", () => {
    expect(only([acquire("dev-core", "t", FUTURE), handoff("dev-core", "t")]).state).toBe(
      "draining",
    );
  });

  it("stop → stopped with the mode in reason", () => {
    const v = only([acquire("dev-core", "t", FUTURE), stop("dev-core", "t", "forced")]);
    expect(v).toMatchObject({ state: "stopped", reason: "forced" });
  });

  it("launch does not change the lease state", () => {
    const v = only([acquire("dev-core", "t", FUTURE), launch("dev-core", "t")]);
    expect(v.state).toBe("running");
    expect(v.lastEvent).toBe("launch");
  });
});

describe("foldLeases — gap 1: working vs stuck (overdue)", () => {
  it("the lease is alive, the deadline has passed → overdue", () => {
    expect(only([acquire("dev-core", "t", PAST)]).overdue).toBe(true);
  });

  it("the lease is alive, the deadline is ahead → not overdue", () => {
    expect(only([acquire("dev-core", "t", FUTURE)]).overdue).toBe(false);
  });

  it("overdue holds in draining too (the turn is gone, but the session is not closed)", () => {
    const v = only([acquire("dev-core", "t", PAST), handoff("dev-core", "t")]);
    expect(v).toMatchObject({ state: "draining", overdue: true });
  });

  it("a released lease with a passed deadline is NOT overdue any more (it is not active)", () => {
    const v = only([acquire("dev-core", "t", PAST), release("dev-core", "t", "timeout")]);
    expect(v.overdue).toBe(false);
  });
});

describe("foldLeases — gap 2: the attempt ceiling (exhausted / launchable)", () => {
  it("an unsuccessful finish below the ceiling → launchable, not exhausted", () => {
    const v = only([acquire("dev-core", "t", PAST), release("dev-core", "t", "timeout")]);
    expect(v).toMatchObject({ attempt: 1, launchable: true, exhausted: false });
  });

  it("a successful finish (completed) → neither launchable nor exhausted", () => {
    const v = only([acquire("dev-core", "t", FUTURE), release("dev-core", "t", "completed")]);
    expect(v).toMatchObject({ launchable: false, exhausted: false });
  });

  it("attempt grows with every taking; at the ceiling — exhausted, not launchable", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      events.push(acquire("dev-core", "t", PAST), release("dev-core", "t", "timeout"));
    }
    const v = only(events);
    expect(v.attempt).toBe(MAX_ATTEMPTS);
    expect(v).toMatchObject({ exhausted: true, launchable: false });
  });

  it("an explicit lease-released reason=exhausted → exhausted regardless of the counter", () => {
    const v = only([acquire("dev-core", "t", PAST), release("dev-core", "t", "exhausted")]);
    expect(v).toMatchObject({ exhausted: true, launchable: false });
  });

  it("exited-without-handoff — the same failure for the ceiling as timeout and forced", () => {
    const v = only([
      acquire("dev-core", "t", PAST),
      release("dev-core", "t", "exited-without-handoff"),
    ]);
    expect(v).toMatchObject({ attempt: 1, launchable: true, exhausted: false });
  });

  it("self-exits accumulate up to the ceiling, after which the pair is not launched", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      events.push(
        acquire("dev-core", "t", PAST),
        release("dev-core", "t", "exited-without-handoff"),
      );
    }
    expect(only(events)).toMatchObject({ exhausted: true, launchable: false });
  });
});

describe("foldLeases — several pairs", () => {
  it("different (role, thread) pairs are independent and keep the order of appearance", () => {
    const views = foldLeases(
      [
        acquire("dev-core", "t1", FUTURE),
        acquire("dev-speech", "t2", PAST),
        release("dev-speech", "t2", "timeout"),
      ],
      NOW,
    );
    expect(views.map((v) => `${v.role}/${v.thread}`)).toEqual(["dev-core/t1", "dev-speech/t2"]);
    expect(views[0]).toMatchObject({ state: "running", overdue: false });
    expect(views[1]).toMatchObject({ state: "released", launchable: true });
  });

  it("the same role on different threads — different pairs", () => {
    const views = foldLeases(
      [acquire("dev-core", "t1", FUTURE), acquire("dev-core", "t2", FUTURE)],
      NOW,
    );
    expect(views).toHaveLength(2);
  });

  it("an empty journal — an empty fold", () => {
    expect(foldLeases([], NOW)).toEqual([]);
  });
});

describe("foldLeases — launch-refused creates no lease", () => {
  const refused = (role: string, thread: string): OrchestratorEvent => ({
    kind: "launch-refused",
    ts: ts(),
    role,
    thread,
    reason: "run-budget",
  });

  it("a pair with launch-refused only — no phantom lease", () => {
    expect(foldLeases([refused("dev-core", "t")], NOW)).toEqual([]);
  });

  it("launch-refused between real events does not distort the pair", () => {
    const v = only([
      refused("dev-core", "t"),
      acquire("dev-core", "t", FUTURE),
      refused("dev-core", "t"),
    ]);
    expect(v).toMatchObject({ state: "running", attempt: 1, lastEvent: "lease-acquired" });
  });
});

describe("unclosedLeases — a lease nobody was left to close", () => {
  it("a live lease makes the list", () => {
    const views = unclosedLeases([acquire("dev-core", "t", FUTURE)], NOW);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ role: "dev-core", state: "running" });
  });

  it("draining counts as live too: the outcome is not recorded", () => {
    const views = unclosedLeases([acquire("dev-core", "t", FUTURE), handoff("dev-core", "t")], NOW);
    expect(views[0]?.state).toBe("draining");
  });

  it("closed for any reason — not live, supervisor-gone included", () => {
    const closed = unclosedLeases(
      [acquire("dev-core", "t", PAST), release("dev-core", "t", "supervisor-gone")],
      NOW,
    );
    expect(closed).toEqual([]);
  });

  it("supervisor-gone — an unsuccessful finish: the pair may be tried again", () => {
    const v = only([acquire("dev-core", "t", PAST), release("dev-core", "t", "supervisor-gone")]);
    expect(v).toMatchObject({ launchable: true, exhausted: false });
  });
});
