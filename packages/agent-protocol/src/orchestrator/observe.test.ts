import { describe, expect, it } from "vitest";

import { handoffDetected, observeStep, stepEvent } from "./observe.js";

const sig = (over: Partial<{ handedOff: boolean; processExited: boolean; overdue: boolean }>) => ({
  handedOff: false,
  processExited: false,
  overdue: false,
  ...over,
});

describe("handoffDetected — a broken thread does not pass itself off as a passed turn", () => {
  const base = { thread: "012-x", waitingThreads: ["012-x"], threadUnreadable: false };

  it("the thread is still waiting on the role → the turn has NOT passed", () => {
    expect(handoffDetected(base)).toBe(false);
  });

  it("the thread stopped waiting on the role → the turn has passed", () => {
    expect(handoffDetected({ ...base, waitingThreads: [] })).toBe(true);
  });

  it("our own thread is unreadable → NOT a passed turn, even though it is not in the waiting list", () => {
    expect(handoffDetected({ ...base, waitingThreads: [], threadUnreadable: true })).toBe(false);
  });

  it("unreadability outweighs an empty list: otherwise the run would close as completed", () => {
    const brokenLooksLikeHandoff = handoffDetected({
      thread: "012-x",
      waitingThreads: [],
      threadUnreadable: true,
    });
    const realHandoff = handoffDetected({
      thread: "012-x",
      waitingThreads: [],
      threadUnreadable: false,
    });
    expect(brokenLooksLikeHandoff).not.toBe(realHandoff);
  });

  it("other threads in the waiting list do not affect the decision", () => {
    expect(handoffDetected({ ...base, waitingThreads: ["009-other", "014-other"] })).toBe(true);
  });
});

describe("observeStep — running", () => {
  it("nothing happened → keep observing (null)", () => {
    expect(observeStep("running", sig({}))).toBeNull();
  });

  it("the turn passed → handoff-detected (into draining), the process is left alone", () => {
    expect(observeStep("running", sig({ handedOff: true }))).toEqual({
      record: "handoff-detected",
    });
  });

  it("a passed turn OUTWEIGHS overdue: noticed at the deadline — still a success", () => {
    expect(observeStep("running", sig({ handedOff: true, overdue: true }))).toEqual({
      record: "handoff-detected",
    });
  });

  it("the deadline without a passed turn → timeout (stuck, the draining limit)", () => {
    expect(observeStep("running", sig({ overdue: true }))).toEqual({
      record: "lease-released",
      reason: "timeout",
    });
  });

  it("the process exited BY ITSELF without passing the turn before the deadline → exited-without-handoff", () => {
    expect(observeStep("running", sig({ processExited: true }))).toEqual({
      record: "lease-released",
      reason: "exited-without-handoff",
    });
  });

  it("a self-exit is NOT passed off as a force — otherwise the journal lies in scenario 3", () => {
    const step = observeStep("running", sig({ processExited: true }));
    expect(step).not.toEqual({ record: "lease-released", reason: "forced" });
  });

  it("code 0 without a passed turn ≠ completion: handedOff=false → NOT completed", () => {
    const step = observeStep("running", sig({ processExited: true }));
    expect(step).not.toEqual({ record: "lease-released", reason: "completed" });
  });

  it("a timeout beats a self-exit: overdue is checked earlier", () => {
    expect(observeStep("running", sig({ processExited: true, overdue: true }))).toEqual({
      record: "lease-released",
      reason: "timeout",
    });
  });
});

describe("observeStep — draining", () => {
  it("the turn has already passed, the process is still alive → wait (null)", () => {
    expect(observeStep("draining", sig({}))).toBeNull();
  });

  it("the process exited by itself → completed (the agent finished writing and left without a signal)", () => {
    expect(observeStep("draining", sig({ processExited: true }))).toEqual({
      record: "lease-released",
      reason: "completed",
    });
  });

  it("the process hung past the deadline → completed (the job is done), the CLI puts it down", () => {
    expect(observeStep("draining", sig({ overdue: true }))).toEqual({
      record: "lease-released",
      reason: "completed",
    });
  });
});

describe("stepEvent", () => {
  const base = { ts: "2026-07-24T14:00:00Z", role: "dev-core", thread: "012-x" };

  it("handoff-detected → an event of the same kind", () => {
    expect(stepEvent({ record: "handoff-detected" }, base)).toEqual({
      kind: "handoff-detected",
      ...base,
    });
  });

  it("lease-released carries the reason", () => {
    expect(stepEvent({ record: "lease-released", reason: "completed" }, base)).toEqual({
      kind: "lease-released",
      ...base,
      reason: "completed",
    });
  });

  it("a new reason reaches the journal event as it is", () => {
    expect(stepEvent({ record: "lease-released", reason: "exited-without-handoff" }, base)).toEqual(
      {
        kind: "lease-released",
        ...base,
        reason: "exited-without-handoff",
      },
    );
  });
});

describe("idle — a stalled session is not a timeout (R6)", () => {
  const running = { handedOff: false, processExited: false, overdue: false };

  it("no traces past the ceiling → stalled", () => {
    expect(observeStep("running", { ...running, idle: true })).toEqual({
      record: "lease-released",
      reason: "stalled",
    });
  });

  it("stalled OUTRANKS the deadline: of two diagnoses at once, the truer one wins", () => {
    // A session goes quiet long before its wall clock runs out; if both fire in the
    // same poll, "it stopped doing anything" says more than "the window ended".
    expect(observeStep("running", { ...running, idle: true, overdue: true })).toEqual({
      record: "lease-released",
      reason: "stalled",
    });
  });

  it("a PASSED TURN outranks idle — success is not cancelled by silence", () => {
    expect(observeStep("running", { ...running, handedOff: true, idle: true })).toEqual({
      record: "handoff-detected",
    });
  });

  it("without the signal nothing changes: the deadline still gives a timeout", () => {
    expect(observeStep("running", { ...running, overdue: true })).toEqual({
      record: "lease-released",
      reason: "timeout",
    });
  });

  it("in draining idle decides nothing — the job is already done", () => {
    expect(observeStep("draining", { ...running, idle: true })).toBeNull();
  });
});

describe("the interactive turn — a passed turn that is not the end (R19)", () => {
  const running = { handedOff: false, processExited: false, overdue: false };

  it("a passed turn WITH a declared wait parks the run instead of draining it", () => {
    expect(observeStep("running", { ...running, handedOff: true, awaitingInput: true })).toEqual({
      record: "input-awaited",
    });
  });

  it("the same mail state WITHOUT a declaration is the end of the run, as before", () => {
    // The one-line difference between the two readings of one fact, and the reason the
    // declaration has to exist at all: from the mail alone they are identical.
    expect(observeStep("running", { ...running, handedOff: true })).toEqual({
      record: "handoff-detected",
    });
  });

  it("while parked, silence decides NOTHING — waiting is not a hang (requirement б)", () => {
    expect(observeStep("waiting", { ...running, awaitingInput: true, idle: true })).toBeNull();
  });

  it("while parked, the WORK deadline decides nothing either — its window is frozen", () => {
    expect(observeStep("waiting", { ...running, awaitingInput: true, overdue: true })).toBeNull();
  });

  it("the declaration going away brings the run back to work", () => {
    // The way out is the marker and not the mail: an answer and the session's own
    // timeout both end the wait, and from the mail's side they look the same.
    expect(observeStep("waiting", { ...running, awaitingInput: false })).toEqual({
      record: "input-received",
    });
  });

  it("nobody answered within the wait's own ceiling → input-timeout, not timeout", () => {
    expect(observeStep("waiting", { ...running, awaitingInput: true, waitOverdue: true })).toEqual({
      record: "lease-released",
      reason: "input-timeout",
    });
  });

  it("the session died while parked → exited-while-waiting, checked BEFORE the answer", () => {
    // A dead session cannot act on an answer, so "it died waiting" is the truer record
    // even if the reply landed in the same second — and `completed` would have been the
    // lie: the package stopped in the middle of its task.
    expect(
      observeStep("waiting", { ...running, processExited: true, awaitingInput: false }),
    ).toEqual({ record: "lease-released", reason: "exited-while-waiting" });
  });

  it("an interactive turn is NOT recorded as completed by any path", () => {
    for (const signals of [
      { ...running, awaitingInput: true, waitOverdue: true },
      { ...running, processExited: true, awaitingInput: true },
    ]) {
      expect(observeStep("waiting", signals)).not.toEqual({
        record: "lease-released",
        reason: "completed",
      });
    }
  });

  it("stepEvent: input-awaited carries the limit OF THE WAIT", () => {
    const base = { ts: "2026-07-26T10:00:00Z", role: "dev-core", thread: "016-x" };
    expect(
      stepEvent({ record: "input-awaited" }, base, { waitDeadline: "2026-07-26T11:00:00Z" }),
    ).toEqual({ kind: "input-awaited", ...base, deadline: "2026-07-26T11:00:00Z" });
  });

  it("stepEvent: a forgotten ceiling gives a wait that expires AT ONCE, never one without a limit", () => {
    const base = { ts: "2026-07-26T10:00:00Z", role: "dev-core", thread: "016-x" };
    expect(stepEvent({ record: "input-awaited" }, base)).toMatchObject({
      deadline: "2026-07-26T10:00:00Z",
    });
  });

  it("stepEvent: input-received is a bare event — what ended the wait is not claimed", () => {
    const base = { ts: "2026-07-26T10:30:00Z", role: "dev-core", thread: "016-x" };
    expect(stepEvent({ record: "input-received" }, base)).toEqual({
      kind: "input-received",
      ...base,
    });
  });
});
