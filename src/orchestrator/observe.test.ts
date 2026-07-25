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
