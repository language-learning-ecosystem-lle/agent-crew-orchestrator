import { describe, expect, it } from "vitest";

import type { OrchestratorEvent } from "./journal.js";
import { foldLeases, type LeaseView } from "./lease.js";
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
    // The state column is the SENTENCE, not the machine word (thread 063) — the words a
    // frame is read in live in `state-word.ts`, and this line only proves the column is
    // there and comes from them.
    expect(line).toContain("working — nothing reported yet");
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
    // machine — john asked twice why a pair marked `draining` was working, and a third
    // time on 2026-08-30 (thread 063). The frame answers in words; the deadline column
    // beside it is the "until when".
    const line = renderStatus([view({ state: "draining" })]);
    expect(line).toContain("already reported");
    expect(line).not.toContain("draining");
    expect(line).toContain("deadline 2026-07-24T13:30:00Z");
  });

  // THE POLICY OF THREAD 019 IS SUPERSEDED BY 063, and this test is where it says so: the
  // translation used to touch `draining` alone, on the argument that every other state
  // "reads as itself". It does not — `released (exited-without-handoff)` is a machine word
  // in brackets, and no state column is left carrying one.
  it("no state column carries a machine word any more (thread 063)", () => {
    // The COLUMN, not the line: a phrase may legitimately contain a machine word ("parked
    // — waiting for a person"), and what must not happen is the column BEING one.
    const machine = new Set(["running", "draining", "waiting", "released", "stopped"]);
    const column = (v: Partial<LeaseView>): string =>
      renderStatus([view(v)]).split("  ·  ")[2] ?? "";
    for (const v of [
      { state: "running" as const },
      { state: "waiting" as const },
      { state: "released" as const, reason: "completed" as const },
      { state: "released" as const, reason: "exited-without-handoff" as const },
      { state: "stopped" as const, reason: "forced" as const },
    ]) {
      expect(machine.has(column(v))).toBe(false);
    }
    // And the reason no longer trails the line as a bare enum in brackets.
    expect(
      renderStatus([view({ state: "released", reason: "exited-without-handoff" })]),
    ).not.toContain("(exited-without-handoff)");
  });

  // john's requirement 5: the frame shows a word and a deadline, and the reader subtracts
  // two ISO stamps in their head to learn whether a role has forty minutes or four.
  it("given a now, the line says how much is left in minutes as well as in stamps", () => {
    const line = renderStatus(
      [view({ state: "draining" })],
      new Set(),
      new Date("2026-07-24T13:00:00Z"),
    );
    expect(line).toContain("30m left of its window");
    expect(line).toContain("deadline 2026-07-24T13:30:00Z");
  });

  // The order of those two is not taste: the observer cuts this line to the terminal's
  // width, and the cut eats the END of it. The phrase a reader reads must sit ahead of
  // the stamp an operator copies, or a narrow terminal loses exactly the half john asked
  // for and the two frames of one fact start disagreeing again.
  it("the countdown stands BEFORE the stamp, so a cut line loses the stamp and not it", () => {
    const line = renderStatus(
      [view({ state: "draining" })],
      new Set(),
      new Date("2026-07-24T13:00:00Z"),
    );
    expect(line.indexOf("30m left of its window")).toBeLessThan(line.indexOf("deadline 2026-"));
  });

  it("without a now the countdown is dropped rather than computed from a guess", () => {
    expect(renderStatus([view({ state: "draining" })])).not.toContain("left of its window");
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

describe("a count past its ceiling never stands there silently (thread 023)", () => {
  // `attempt 4/3` with nothing beside it shows the reader a ceiling and a number over it
  // and leaves them to work out which one is lying. Neither is: a THAW raises a frozen
  // pair once more (thread 013), and the run it raises is the fourth of three. The frame
  // is checked through the REAL fold rather than a hand-built view — the defect lives in
  // the join between the two, and a string assembled in a test would never show it.
  const NOW = new Date("2026-07-24T14:00:00Z");
  const externalBreak = (at: string): OrchestratorEvent => ({
    kind: "lease-released",
    ts: at,
    role: "dev-core",
    thread: "t",
    reason: "timeout",
    external: true,
  });
  const acquired = (at: string): OrchestratorEvent => ({
    kind: "lease-acquired",
    ts: at,
    role: "dev-core",
    thread: "t",
    deadline: "2026-07-24T15:00:00Z",
  });

  /** Three of the pair's OWN breaks, external class — the freeze that thaws by a clock. */
  const spent: OrchestratorEvent[] = [
    acquired("2026-07-24T12:00:00Z"),
    externalBreak("2026-07-24T12:01:00Z"),
    acquired("2026-07-24T12:10:00Z"),
    externalBreak("2026-07-24T12:11:00Z"),
    acquired("2026-07-24T12:20:00Z"),
    externalBreak("2026-07-24T12:21:00Z"),
  ];

  it("the run a thaw raised prints 4/3 AND says why", () => {
    const views = foldLeases([...spent, acquired("2026-07-24T13:59:00Z")], NOW);
    expect(views[0]).toMatchObject({ attempt: 4, ceiling: 3, state: "running", exhausted: false });
    const line = renderStatus(views);
    expect(line).toContain("attempt 4/3");
    expect(line).toContain("past the ceiling");
  });

  it("no line anywhere in the frame shows N/M with N>M and no word about it", () => {
    // The regression itself, written as the rule and not as one case of it.
    const views = foldLeases([...spent, acquired("2026-07-24T13:59:00Z")], NOW);
    for (const line of renderStatus(views).split("\n")) {
      const count = /attempt (\d+)\/(\d+)/.exec(line);
      if (count === null) continue;
      if (Number(count[1]) <= Number(count[2])) continue;
      expect(line, `an unexplained '${count[0]}'`).toMatch(/EXHAUSTED|exhausted|past the ceiling/);
    }
  });

  it("while the pair IS exhausted the flag carries it, and the column does not repeat it", () => {
    const line = renderLeaseLine(view({ attempt: 4, ceiling: 3, exhausted: true }));
    expect(line).toContain("attempt 4/3");
    expect(line).toContain("EXHAUSTED");
    expect(line).not.toContain("past the ceiling");
  });

  it("a count at or below its ceiling reads exactly as it always did", () => {
    expect(renderLeaseLine(view({ attempt: 3, ceiling: 3 }))).toContain("attempt 3/3");
    expect(renderLeaseLine(view({ attempt: 3, ceiling: 3 }))).not.toContain("past the ceiling");
  });
});
