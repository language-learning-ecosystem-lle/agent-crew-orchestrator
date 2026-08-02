import { describe, expect, it } from "vitest";

import type { LeaseView } from "./lease.js";
import { renderLeaseLine, renderStatus } from "./status.js";

const view = (partial: Partial<LeaseView>): LeaseView => ({
  role: "dev-core",
  thread: "014-reviewer-verdict-delivery",
  state: "running",
  attempt: 1,
  ceiling: 3,
  deadline: "2026-07-24T13:30:00Z",
  waitDeadline: null,
  reason: null,
  lastEvent: "lease-acquired",
  overdue: false,
  exhausted: false,
  launchable: false,
  ...partial,
});

describe("renderStatus", () => {
  it("an empty fold gives an honest line, not empty output", () => {
    expect(renderStatus([])).toBe("orchestrator: no sessions in the journal");
  });

  it("a normal line carries the role, thread, state, attempt and deadline", () => {
    const line = renderStatus([view({})]);
    expect(line).toContain("dev-core");
    expect(line).toContain("014-reviewer-verdict-delivery");
    expect(line).toContain("running");
    // The ceiling travels with the count — the number alone said nothing about how
    // close the pair was to dropping out.
    expect(line).toContain("attempt 1/3");
    expect(line).toContain("deadline 2026-07-24T13:30:00Z");
  });

  it("overdue is called out as an explicit mark", () => {
    expect(renderStatus([view({ overdue: true })])).toContain("OVERDUE");
  });

  it("exhausted is called out as an explicit mark and points at the journal", () => {
    const line = renderStatus([
      view({ state: "released", reason: "timeout", attempt: 3, exhausted: true }),
    ]);
    expect(line).toContain("EXHAUSTED");
    expect(line).toContain("journal");
  });

  it("exhausted takes priority over overdue in the mark", () => {
    // exhausted is terminal (the lease is released), overdue will not be set
    // alongside it here, but the mark must not double up anyway — exhaustion wins.
    const line = renderStatus([view({ exhausted: true, overdue: true })]);
    expect(line).toContain("EXHAUSTED");
    expect(line).not.toContain("OVERDUE");
  });

  it("a parked run shows the clock actually in force, and its overrun reads differently (R19)", () => {
    // The two overruns mean opposite things: a work window that ran out is a session
    // that did not fit, a wait that ran out is a human who has not answered. One mark
    // for both would have sent the reader looking for the wrong failure.
    const line = renderStatus([
      view({ state: "waiting", waitDeadline: "2026-07-24T14:30:00Z", overdue: true }),
    ]);
    expect(line).toContain("waiting");
    expect(line).toContain("awaiting input until 2026-07-24T14:30:00Z");
    expect(line).toContain("THE WAIT EXPIRED");
    expect(line).not.toContain("⚠ OVERDUE");
  });

  it("draining reads as work, not as shutdown, and keeps its landing point (thread 019)", () => {
    // The lifecycle word says "shutting down" to a reader who did not write the state
    // machine — john asked twice why a pair marked `draining` was working. The frame
    // answers in words; the deadline column beside it is the "until when".
    const line = renderStatus([view({ state: "draining" })]);
    expect(line).toContain("working past handoff");
    expect(line).not.toContain("draining");
    expect(line).toContain("deadline 2026-07-24T13:30:00Z");
  });

  it("the translation touches draining only — every other state reads as itself", () => {
    expect(renderStatus([view({ state: "running" })])).toContain("running");
    expect(renderStatus([view({ state: "waiting" })])).toContain("waiting");
    expect(renderStatus([view({ state: "released", reason: "completed" })])).toContain("released");
    expect(renderStatus([view({ state: "stopped", reason: "forced" })])).toContain("stopped");
  });

  it("a null deadline is printed as a dash", () => {
    expect(renderStatus([view({ deadline: null })])).toContain("deadline —");
  });

  it("several pairs — one line each", () => {
    const out = renderStatus([view({ thread: "a" }), view({ thread: "b" })]);
    expect(out.split("\n")).toHaveLength(2);
  });
});

describe("renderLeaseLine (T-1)", () => {
  // The observer highlights the SELECTED pair, so it needs the lines one at a time.
  // Exporting the formatter is the whole of that change: a second renderer for the
  // same columns is how the top panel and `status` would begin to differ.
  it("is the very line renderStatus assembles", () => {
    const one = view({ thread: "019-operator-ux" });
    expect(renderStatus([one])).toBe(renderLeaseLine(one));
  });

  it("carries the marks, not just the columns", () => {
    expect(renderLeaseLine(view({ exhausted: true }))).toContain("EXHAUSTED");
  });
});
