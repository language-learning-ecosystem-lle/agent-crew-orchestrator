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

  // THE WORD "THEN" NEEDS A MOMENT TO POINT AT (thread 016, defect 2). The tail was glued
  // on unconditionally, and #23 gave the two terminal branches words that name a HAND and
  // no term at all — so half the sentence went on promising a deadline the other half had
  // stopped naming. The same class of defect as the one #23 fixed, in the same sentence.
  it("names a term only where the freeze has one", () => {
    const thawing = renderStatus([
      view({
        exhausted: true,
        exhaustedClass: "external",
        thawAt: "2026-08-19T12:15:00Z",
      }),
    ]);
    expect(thawing).toContain("thaws at 2026-08-19T12:15:00Z");
    expect(thawing).toContain("no more attempts until then");

    for (const spent of [
      view({ exhausted: true, exhaustedClass: "substantive", thawAt: null }),
      view({ exhausted: true, exhaustedClass: "external", thawAt: null }),
    ]) {
      const line = renderStatus([spent]);
      expect(line).toContain("no more attempts;");
      expect(line).not.toContain("until then");
    }
  });

  // THE MARK IS A CALL TO A HAND, AND A CLOSED THREAD HAS NOTHING TO CALL ONE FOR (thread
  // 016, п.2). The row itself stays — the frame prints the history of the journal, and that
  // history happened — but `⚠ EXHAUSTED` and the advice about zeroing the count go, because
  // a delivery of this pair is written by a run and a closed thread gets no runs.
  it("a closed thread keeps its row and loses the mark", () => {
    const closed = view({ thread: "001-mail-born", exhausted: true, attempt: 3 });

    const called = renderStatus([closed]);
    expect(called).toContain("⚠ EXHAUSTED");

    const history = renderStatus([closed], new Set(["001-mail-born"]));
    // The row is intact: role, thread and the count are still there to be read.
    expect(history).toContain("001-mail-born");
    expect(history).toContain("attempt 3/3");
    // …and nothing in it asks anybody to do anything.
    expect(history).not.toContain("⚠ EXHAUSTED");
    expect(history).not.toContain("--max-attempts");
    expect(history).not.toContain("what zeroes the count");
    expect(history).toContain("THREAD IS CLOSED");
  });

  it("only the closed thread's own line loses the mark", () => {
    const line = renderStatus(
      [
        view({ thread: "001-mail-born", exhausted: true }),
        view({ thread: "016-open", exhausted: true }),
      ],
      new Set(["001-mail-born"]),
    );
    const [first, second] = line.split("\n");
    expect(first).not.toContain("⚠ EXHAUSTED");
    expect(second).toContain("⚠ EXHAUSTED");
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
