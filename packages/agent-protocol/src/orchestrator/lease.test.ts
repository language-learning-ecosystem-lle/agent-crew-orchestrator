import { describe, expect, it } from "vitest";
import { marksOfSessions, NO_DELIVERY_MARKS, pairKey } from "../thread/index-doc.js";

import { MAX_ATTEMPTS, type OrchestratorEvent } from "./journal.js";
import { foldLeases, isDelivery, type LeaseView, unclosedLeases } from "./lease.js";

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
  session?: string,
): OrchestratorEvent => ({
  kind: "lease-released",
  ts: ts(),
  role,
  thread,
  reason,
  ...(session === undefined ? {} : { session }),
});
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
/** The two events of an interactive turn (R19). Their STAMPS matter here — the fold
 * shifts the work deadline by the distance between them — so they are given by hand. */
const awaited = (
  role: string,
  thread: string,
  at: string,
  deadline: string,
): OrchestratorEvent => ({ kind: "input-awaited", ts: at, role, thread, deadline });
const received = (role: string, thread: string, at: string): OrchestratorEvent => ({
  kind: "input-received",
  ts: at,
  role,
  thread,
});

const only = (events: OrchestratorEvent[]): LeaseView => {
  const views = foldLeases(events, NOW);
  expect(views).toHaveLength(1);
  return views[0] as LeaseView;
};

describe("isDelivery — the one word both ceilings reset on", () => {
  it("a handoff and a completed release deliver; nothing else does", () => {
    expect(isDelivery(handoff("dev-core", "t"))).toBe(true);
    expect(isDelivery(release("dev-core", "t", "completed"))).toBe(true);
    expect(isDelivery(release("dev-core", "t", "supervisor-gone"))).toBe(false);
    expect(isDelivery(release("dev-core", "t", "timeout"))).toBe(false);
    expect(isDelivery(release("dev-core", "t", "exited-without-handoff"))).toBe(false);
    expect(isDelivery(launch("dev-core", "t"))).toBe(false);
    expect(isDelivery(acquire("dev-core", "t", FUTURE))).toBe(false);
  });
});

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

  it("attempt grows with every FAILED taking; at the ceiling — exhausted, not launchable", () => {
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

describe("foldLeases — the counter is consecutive, not cumulative", () => {
  // The defect of 2026-07-26: dev-core×016 stood at `attempt 13` with eleven
  // completions behind it and dropped out of the candidates for good. A ceiling that
  // counts successes is not a protection, it is a bomb with a counter.
  it("a completed run resets the count — failures BEFORE it do not accumulate", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      events.push(acquire("dev-core", "t", PAST), release("dev-core", "t", "timeout"));
    }
    events.push(acquire("dev-core", "t", FUTURE), release("dev-core", "t", "completed"));
    events.push(acquire("dev-core", "t", PAST), release("dev-core", "t", "timeout"));
    expect(only(events)).toMatchObject({ attempt: 1, exhausted: false, launchable: true });
  });

  it("a long-lived pair that keeps delivering never reaches the ceiling", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < 13; i += 1) {
      events.push(
        acquire("dev-core", "t", FUTURE),
        handoff("dev-core", "t"),
        release("dev-core", "t", "completed"),
      );
    }
    events.push(acquire("dev-core", "t", PAST), release("dev-core", "t", "timeout"));
    expect(only(events)).toMatchObject({ attempt: 1, exhausted: false, launchable: true });
  });

  it("failures WITHOUT a delivery still accumulate to the ceiling — the loop is caught", () => {
    const events: OrchestratorEvent[] = [
      acquire("dev-core", "t", FUTURE),
      release("dev-core", "t", "completed"),
    ];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      events.push(acquire("dev-core", "t", PAST), release("dev-core", "t", "timeout"));
    }
    expect(only(events)).toMatchObject({ attempt: MAX_ATTEMPTS, exhausted: true });
  });

  it("a handoff resets it too: the turn was passed, whatever the supervisor managed to write", () => {
    // supervisor-gone AFTER a handoff is a fault of the supervisor's, not of the run:
    // the work arrived. Counting it as a failed attempt would walk a productive pair
    // towards the ceiling for somebody else's death.
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      events.push(
        acquire("dev-core", "t", PAST),
        handoff("dev-core", "t"),
        release("dev-core", "t", "supervisor-gone"),
      );
    }
    expect(only(events)).toMatchObject({ attempt: 0, exhausted: false });
  });

  it("the ceiling is a parameter: the same journal, a different verdict", () => {
    const events: OrchestratorEvent[] = [
      acquire("dev-core", "t", PAST),
      release("dev-core", "t", "timeout"),
      acquire("dev-core", "t", PAST),
      release("dev-core", "t", "timeout"),
    ];
    expect(foldLeases(events, NOW, 2)[0]).toMatchObject({ exhausted: true, ceiling: 2 });
    expect(foldLeases(events, NOW, 5)[0]).toMatchObject({ exhausted: false, ceiling: 5 });
  });

  it("without a ceiling given, the package default is the one reported", () => {
    expect(only([acquire("dev-core", "t", FUTURE)]).ceiling).toBe(MAX_ATTEMPTS);
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

describe("foldLeases — the interactive turn (R19)", () => {
  // A work window of an hour from 12:00, a wait declared at 12:10 with a ceiling at
  // 13:10. NOW is 14:00, so "which clock is in force" is decidable by the numbers.
  const OPENED = "2026-07-24T13:00:00Z"; // the work deadline, before NOW
  const AT = "2026-07-24T12:10:00Z";
  const WAIT_UNTIL = "2026-07-24T15:10:00Z"; // after NOW
  const BACK = "2026-07-24T12:40:00Z"; // 30 minutes later

  it("input-awaited → waiting, with the wait's own deadline beside the work one", () => {
    const v = only([acquire("dev-core", "t", OPENED), awaited("dev-core", "t", AT, WAIT_UNTIL)]);
    expect(v).toMatchObject({ state: "waiting", deadline: OPENED, waitDeadline: WAIT_UNTIL });
  });

  it("a parked lease is ALIVE — nothing may be launched on the pair", () => {
    // The guard both launch paths share: a parked pair becomes a candidate the moment
    // its answer lands, which is exactly when a second session would land on a live one.
    const views = unclosedLeases(
      [acquire("dev-core", "t", OPENED), awaited("dev-core", "t", AT, WAIT_UNTIL)],
      NOW,
    );
    expect(views).toHaveLength(1);
    expect(views[0]?.state).toBe("waiting");
  });

  it("while parked, the WORK deadline does not make it overdue — the wait's does", () => {
    // The work deadline (13:00) is already behind NOW (14:00) and decides nothing; the
    // wait ceiling (15:10) is ahead, so nothing is late. Judging a park by the work
    // window would report every long wait as a session that overran.
    expect(
      only([acquire("dev-core", "t", OPENED), awaited("dev-core", "t", AT, WAIT_UNTIL)]).overdue,
    ).toBe(false);
    expect(
      only([acquire("dev-core", "t", OPENED), awaited("dev-core", "t", AT, PAST)]).overdue,
    ).toBe(true);
  });

  it("input-received → running, and the work window gets back exactly the time waited", () => {
    // 30 minutes parked → the deadline moves from 13:00 to 13:30. This is john's
    // requirement (в) as arithmetic: waiting does not eat the window given to the work.
    const v = only([
      acquire("dev-core", "t", OPENED),
      awaited("dev-core", "t", AT, WAIT_UNTIL),
      received("dev-core", "t", BACK),
    ]);
    expect(v).toMatchObject({
      state: "running",
      deadline: "2026-07-24T13:30:00Z",
      waitDeadline: null,
    });
  });

  it("two waits in one run shift the deadline twice", () => {
    const v = only([
      acquire("dev-core", "t", OPENED),
      awaited("dev-core", "t", AT, WAIT_UNTIL),
      received("dev-core", "t", BACK),
      awaited("dev-core", "t", "2026-07-24T12:50:00Z", WAIT_UNTIL),
      received("dev-core", "t", "2026-07-24T13:00:00Z"),
    ]);
    expect(v.deadline).toBe("2026-07-24T13:40:00Z");
  });

  it("NEITHER ending of a park counts towards the attempt ceiling", () => {
    // Both leave the mail consistent — the question is in the thread and the turn is
    // with somebody else — which is the opposite of the gap the ceiling exists for.
    // Exhausting a pair here would punish the one thing that is meant to happen: a
    // human taking their time.
    for (const reason of ["input-timeout", "exited-while-waiting"] as const) {
      const events: OrchestratorEvent[] = [];
      for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
        events.push(acquire("dev-core", "t", OPENED), awaited("dev-core", "t", AT, WAIT_UNTIL), {
          kind: "lease-released",
          ts: ts(),
          role: "dev-core",
          thread: "t",
          reason,
        });
      }
      expect(only(events), reason).toMatchObject({ exhausted: false, launchable: false });
    }
  });

  it("a new lease on the pair forgets the previous run's wait", () => {
    const v = only([
      acquire("dev-core", "t", OPENED),
      awaited("dev-core", "t", AT, WAIT_UNTIL),
      { kind: "lease-released", ts: ts(), role: "dev-core", thread: "t", reason: "input-timeout" },
      acquire("dev-core", "t", FUTURE),
    ]);
    expect(v).toMatchObject({ state: "running", waitDeadline: null, deadline: FUTURE });
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

describe("the turn that stayed on the role (thread 023)", () => {
  // Both halves of the judgement are pinned here, and that is the point of the pair:
  // the run that DELIVERED and parked must not count, the one that died silently must.
  const mine = marksOfSessions(new Set(["session-a"]));

  it("a run whose session wrote into the mail delivers, though the turn stayed", () => {
    const events = [
      acquire("curator", "023", "2026-07-24T13:00:00Z"),
      release("curator", "023", "exited-without-handoff", "session-a"),
    ];
    const view = foldLeases(events, NOW, 3, mine)[0] as LeaseView;
    expect(view.attempt).toBe(0);
    expect(view.exhausted).toBe(false);
    expect(view.launchable).toBe(false);
    // The journal is not rewritten: it says what the observer saw.
    expect(view.reason).toBe("exited-without-handoff");
  });

  it("three such runs do NOT exhaust the pair — the historical shape of the defect", () => {
    const events = [
      acquire("curator", "016", "2026-07-24T13:00:00Z"),
      release("curator", "016", "exited-without-handoff", "session-a"),
      acquire("curator", "016", "2026-07-24T13:00:00Z"),
      release("curator", "016", "exited-without-handoff", "session-a"),
      acquire("curator", "016", "2026-07-24T13:00:00Z"),
      release("curator", "016", "exited-without-handoff", "session-a"),
    ];
    expect((foldLeases(events, NOW, 3, mine)[0] as LeaseView).exhausted).toBe(false);
    // ...and without the mail the same journal reads exactly as it did before.
    expect((foldLeases(events, NOW, 3)[0] as LeaseView).exhausted).toBe(true);
  });

  it("a session that wrote NOTHING still counts — silence is the failure the ceiling is for", () => {
    const events = [
      acquire("dev-core", "023", "2026-07-24T13:00:00Z"),
      release("dev-core", "023", "exited-without-handoff", "session-dead"),
    ];
    const view = foldLeases(events, NOW, 3, mine)[0] as LeaseView;
    expect(view.attempt).toBe(1);
    expect(view.launchable).toBe(true);
  });

  it("a release without a session id counts too — nothing ties it to a message", () => {
    const events = [
      acquire("dev-core", "023", "2026-07-24T13:00:00Z"),
      release("dev-core", "023", "exited-without-handoff"),
    ];
    expect((foldLeases(events, NOW, 3, mine)[0] as LeaseView).launchable).toBe(true);
  });

  it("only THIS release is reclassified — a timeout of the same session still fails", () => {
    const events = [
      acquire("dev-core", "023", "2026-07-24T13:00:00Z"),
      release("dev-core", "023", "timeout", "session-a"),
    ];
    expect((foldLeases(events, NOW, 3, mine)[0] as LeaseView).launchable).toBe(true);
  });
});

describe("the run that could not name its own session (thread 021)", () => {
  // The window `provenanceFrom` documents, in events: the message goes out while the
  // supervisor has not yet written the id file, so the header carries `worker` and no
  // `session:` — and the release carries an id nothing in the mail can match.
  const at = (kind: "lease-acquired" | "lease-released", stamp: string): OrchestratorEvent =>
    kind === "lease-acquired"
      ? { kind, ts: stamp, role: "curator", thread: "021", deadline: "2026-08-21T15:00:00Z" }
      : {
          kind,
          ts: stamp,
          role: "curator",
          thread: "021",
          reason: "exited-without-handoff",
          session: "session-nobody-saw",
        };
  const run = [
    at("lease-acquired", "2026-08-21T13:00:00Z"),
    at("lease-released", "2026-08-21T13:40:00Z"),
  ];
  const wrote = (role: string, thread: string, ...stamps: string[]) =>
    ({
      sessions: new Set<string>(),
      runMessages: new Map([[pairKey(role, thread), stamps.map((s) => Date.parse(s))]]),
    }) as const;

  it("a message of this role, in this thread, inside the lease window IS the delivery", () => {
    const view = foldLeases(
      run,
      NOW,
      3,
      wrote("curator", "021", "2026-08-21T13:39:12Z"),
    )[0] as LeaseView;
    expect(view.attempt).toBe(0);
    expect(view.exhausted).toBe(false);
    // The journal keeps saying what the observer saw — the reading is what changed.
    expect(view.reason).toBe("exited-without-handoff");
  });

  it("three of them do not close the pair, while the same journal without the mail does", () => {
    const three = [...run, ...run, ...run];
    expect(
      (foldLeases(three, NOW, 3, wrote("curator", "021", "2026-08-21T13:39:12Z"))[0] as LeaseView)
        .exhausted,
    ).toBe(false);
    expect((foldLeases(three, NOW, 3)[0] as LeaseView).exhausted).toBe(true);
  });

  // The three narrowings, one test each: without them the second sign would swallow the
  // honest `exited-without-handoff` the ceiling exists for.
  it("a session that died silently still spends its attempt", () => {
    const view = foldLeases(run, NOW, 3, wrote("curator", "021"))[0] as LeaseView;
    expect(view.attempt).toBe(1);
    expect(view.launchable).toBe(true);
  });

  it("a message of the same pair from BEFORE the acquire is not this run's delivery", () => {
    const view = foldLeases(
      run,
      NOW,
      3,
      wrote("curator", "021", "2026-08-21T12:59:59Z"),
    )[0] as LeaseView;
    expect(view.attempt).toBe(1);
  });

  it("a message of the same role in ANOTHER thread is not this pair's delivery", () => {
    const view = foldLeases(
      run,
      NOW,
      3,
      wrote("curator", "020", "2026-08-21T13:39:12Z"),
    )[0] as LeaseView;
    expect(view.attempt).toBe(1);
  });

  it("a message of ANOTHER role in this thread is not this pair's delivery", () => {
    const view = foldLeases(
      run,
      NOW,
      3,
      wrote("dev-core", "021", "2026-08-21T13:39:12Z"),
    )[0] as LeaseView;
    expect(view.attempt).toBe(1);
  });

  it("only `exited-without-handoff` is reclassified — a timeout inside the window still fails", () => {
    const timedOut: OrchestratorEvent[] = [
      at("lease-acquired", "2026-08-21T13:00:00Z"),
      {
        kind: "lease-released",
        ts: "2026-08-21T13:40:00Z",
        role: "curator",
        thread: "021",
        reason: "timeout",
      },
    ];
    const view = foldLeases(
      timedOut,
      NOW,
      3,
      wrote("curator", "021", "2026-08-21T13:39:12Z"),
    )[0] as LeaseView;
    expect(view.attempt).toBe(1);
  });
});

describe("the transcript of the pair (T-1, thread 019)", () => {
  // The observer's bottom panel is the session's own file. Where it lies is derived
  // here, from the acquire moment the journal already carries, by the very function
  // the supervisor writes by — a reader scanning `sessions/` for a matching prefix
  // would be a second answer to a question that has one.
  const SESSIONS = "/state/.orchestrator/sessions";

  it("names the file of the pair's LAST run", () => {
    const started = acquire("dev-core", "019", FUTURE);
    const [view] = foldLeases([started], NOW, 3, NO_DELIVERY_MARKS, SESSIONS);
    // The name is the acquire's own stamp, colons swapped — the same composition the
    // supervisor uses, asserted against the event rather than against a copy of it.
    expect((view as LeaseView).sessionLog).toBe(
      `${SESSIONS}/${started.ts.replaceAll(":", "-")}-dev-core-019.log`,
    );
  });

  it("a new acquire moves the panel onto the new run, not the one the break left behind", () => {
    const first = acquire("dev-core", "019", PAST);
    const second = acquire("dev-core", "019", FUTURE);
    const events = [first, release("dev-core", "019", "timeout"), second];
    const [view] = foldLeases(events, NOW, 3, NO_DELIVERY_MARKS, SESSIONS);
    expect((view as LeaseView).sessionLog).toBe(
      `${SESSIONS}/${second.ts.replaceAll(":", "-")}-dev-core-019.log`,
    );
    expect((view as LeaseView).sessionLog).not.toContain(first.ts.replaceAll(":", "-"));
  });

  it("a caller that did not say where the sessions lie gets no path at all", () => {
    const [view] = foldLeases([acquire("dev-core", "019", FUTURE)], NOW, 3);
    expect((view as LeaseView).sessionLog).toBeUndefined();
  });

  it("a pair with no acquire behind it names nothing — there is no run to point at", () => {
    // A journal can hold a pair that was only ever refused or stopped; inventing a
    // name from the moment of THAT event would point at a file nobody ever wrote.
    const events: OrchestratorEvent[] = [
      { kind: "stop", ts: ts(), role: "dev-core", thread: "019", mode: "graceful" },
    ];
    const [view] = foldLeases(events, NOW, 3, NO_DELIVERY_MARKS, SESSIONS);
    expect((view as LeaseView).sessionLog).toBeUndefined();
  });
});

describe("foldLeases — the class of a freeze and its self-thaw (thread 013)", () => {
  // The episode of 2026-08-18: three attempts spent on `API Error: 529`, all of them dead
  // before the first assistant step. The supervisor writes `external` on such a release;
  // everything below is what the fold makes of it.
  const externalBreak = (role: string, thread: string, at: string): OrchestratorEvent => ({
    kind: "lease-released",
    ts: at,
    role,
    thread,
    reason: "exited-without-handoff",
    external: true,
  });
  const spent = (role: string, thread: string, at: string): OrchestratorEvent[] => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      events.push(acquire(role, thread, PAST), externalBreak(role, thread, ts()));
    }
    events.push(acquire(role, thread, PAST), externalBreak(role, thread, at));
    return events;
  };

  const at =
    (iso: string) =>
    (events: OrchestratorEvent[]): LeaseView => {
      const views = foldLeases(events, new Date(iso), MAX_ATTEMPTS);
      expect(views).toHaveLength(1);
      return views[0] as LeaseView;
    };

  it("an external exhaustion carries its class and the moment it lifts", () => {
    const v = at("2026-07-24T14:00:00Z")(spent("dev-core", "t", "2026-07-24T13:50:00Z"));
    expect(v).toMatchObject({
      exhausted: true,
      launchable: false,
      exhaustedClass: "external",
      thawAt: "2026-07-24T14:05:00Z",
    });
  });

  it("the same journal, fifteen minutes on → thawed: exhausted no more, launchable again", () => {
    const v = at("2026-07-24T14:06:00Z")(spent("dev-core", "t", "2026-07-24T13:50:00Z"));
    expect(v).toMatchObject({
      exhausted: false,
      launchable: true,
      exhaustedClass: "external",
      thawAt: "2026-07-24T14:05:00Z",
    });
  });

  it("a substantive exhaustion never thaws, however long the journal stands", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      events.push(
        acquire("dev-core", "t", PAST),
        release("dev-core", "t", "exited-without-handoff"),
      );
    }
    const v = at("2026-08-24T14:00:00Z")(events);
    expect(v).toMatchObject({
      exhausted: true,
      launchable: false,
      exhaustedClass: "substantive",
      thawAt: null,
    });
  });

  // The flag is the class of ONE release: a pair that failed externally and then worked
  // must not carry it into the next freeze.
  it("a delivery in between clears the class as it clears the counter", () => {
    const events = [
      ...spent("dev-core", "t", "2026-07-24T13:50:00Z"),
      acquire("dev-core", "t", PAST),
      handoff("dev-core", "t"),
      release("dev-core", "t", "completed"),
      acquire("dev-core", "t", PAST),
      release("dev-core", "t", "timeout"),
    ];
    const v = at("2026-07-24T14:00:00Z")(events);
    expect(v).toMatchObject({ attempt: 1, exhausted: false, launchable: true });
    expect(v.exhaustedClass).toBeUndefined();
  });

  // A pair below the ceiling has no freeze, hence no class: the fields are a property of
  // the freeze and not of the pair.
  it("says nothing about a class while the ceiling has not been reached", () => {
    const v = at("2026-07-24T14:00:00Z")([
      acquire("dev-core", "t", PAST),
      externalBreak("dev-core", "t", "2026-07-24T13:50:00Z"),
    ]);
    expect(v.exhaustedClass).toBeUndefined();
    expect(v.thawAt).toBeUndefined();
  });

  // THE IDENTITY OF THE SERIES (thread 013, curator's requirement): the courier owes a
  // frozen pair one call per series, and the pair leaves the exhausted set at every thaw —
  // so the stamp has to survive the gap and end only where the counter does.
  it("stamps the series at the FIRST freeze and does not move it through the rounds", () => {
    const events = spent("dev-core", "t", "2026-07-24T13:50:00Z");
    const first = at("2026-07-24T14:00:00Z")(events).exhaustedSince;
    expect(first).toBe("2026-07-24T13:50:00Z");
    // Thawed and running again: no freeze is in force, the series is still the same one.
    events.push(acquire("dev-core", "t", FUTURE));
    const midRun = at("2026-07-24T14:06:00Z")(events);
    expect(midRun.exhaustedClass).toBeUndefined();
    expect(midRun.exhaustedSince).toBe(first);
    // The retry fails externally too — the second round of the SAME series.
    events.push(externalBreak("dev-core", "t", "2026-07-24T13:55:00Z"));
    expect(at("2026-07-24T14:06:00Z")(events).exhaustedSince).toBe(first);
  });

  it("a delivery ends the series — the next freeze is a new one, with its own stamp", () => {
    const events = [
      ...spent("dev-core", "t", "2026-07-24T13:50:00Z"),
      acquire("dev-core", "t", PAST),
      handoff("dev-core", "t"),
      release("dev-core", "t", "completed"),
    ];
    expect(at("2026-07-24T14:00:00Z")(events).exhaustedSince).toBeUndefined();
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      events.push(
        acquire("dev-core", "t", PAST),
        externalBreak("dev-core", "t", "2026-07-24T13:58:00Z"),
      );
    }
    expect(at("2026-07-24T14:00:00Z")(events).exhaustedSince).toBe("2026-07-24T13:58:00Z");
  });

  it("the backoff walks 15 → 60 → 240 with the attempts, then freezes for good", () => {
    const events = spent("dev-core", "t", "2026-07-24T13:50:00Z");
    events.push(
      acquire("dev-core", "t", PAST),
      externalBreak("dev-core", "t", "2026-07-24T13:50:00Z"),
    );
    expect(at("2026-07-24T14:00:00Z")(events).thawAt).toBe("2026-07-24T14:50:00Z");
    events.push(
      acquire("dev-core", "t", PAST),
      externalBreak("dev-core", "t", "2026-07-24T13:50:00Z"),
    );
    expect(at("2026-07-24T14:00:00Z")(events).thawAt).toBe("2026-07-24T17:50:00Z");
    events.push(
      acquire("dev-core", "t", PAST),
      externalBreak("dev-core", "t", "2026-07-24T13:50:00Z"),
    );
    const last = at("2026-07-25T14:00:00Z")(events);
    expect(last).toMatchObject({ exhausted: true, launchable: false, thawAt: null });
  });
});
