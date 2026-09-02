import { describe, expect, it } from "vitest";
import type { HeldMailLock } from "../thread/checkout-lock.js";
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

/**
 * THE PAIR IS UP AND THE CHILD HAS NOT SPOKEN YET (thread 063, `restore`; curator's answer
 * of 2026-09-02). The window is the one between the lease and the first line of the vendor's
 * stream — measured by the absence of the run's `.session` file — and the two conditions of
 * the answer are asserted here by name: the sentence must not call the pair silent, and it
 * must name its own window instead of guessing at the cause of it.
 */
describe("renderStatus — raised, and the child has not spoken yet", () => {
  const LOG = "/s/2026-09-02T15-00-00Z-dev-core-063-state-model-rewrite.log";

  it("a running pair whose session id is not on disk says so, and says the next step is to wait", () => {
    const line = renderStatus([view({ sessionLog: LOG })], new Set(), undefined, new Set([LOG]));
    expect(line).toContain("THE CHILD HAS NOT SPOKEN YET");
    expect(line).toContain("no process to go and kill");
    expect(line).toContain("the next step here is to wait");
  });

  it("and it does NOT call the pair silent — the log is open and growing in this window", () => {
    // Condition 1 of the answer: `writeLog` fills the session log BEFORE the spawn, so
    // `logBytes` moves here. A mark that read as "nothing has been reported" would send the
    // operator to the very kill this line exists to prevent.
    const line = renderStatus([view({ sessionLog: LOG })], new Set(), undefined, new Set([LOG]));
    expect(line).toContain("Its log is open and growing");
    expect(line).toContain("this pair is not a silent one");
    expect(line).not.toMatch(/says nothing|nothing has been reported|reported nothing/);
  });

  it("and it names the WINDOW, not a cause: the words 'memory' and 'restore' promise nothing measured", () => {
    // Condition 2: two sub-cases live inside this window (a memory restore, and the plain
    // gap between the spawn and the first line of the stream) and nothing tells them apart.
    // The sentence may offer them as alternatives; it may not assert one.
    const line = renderStatus([view({ sessionLog: LOG })], new Set(), undefined, new Set([LOG]));
    expect(line).toContain("either still being started or restoring its own memory");
    expect(line).not.toContain("WRITING MEMORY");
  });

  it("a run whose session id IS on disk keeps the row it always had", () => {
    const line = renderStatus([view({ sessionLog: LOG })], new Set(), undefined, new Set());
    expect(line).not.toContain("HAS NOT SPOKEN YET");
  });

  it("the window belongs to a LIVE row: a released pair with no id file is history, not a call to wait", () => {
    const line = renderStatus(
      [view({ state: "released", sessionLog: LOG })],
      new Set(),
      undefined,
      new Set([LOG]),
    );
    expect(line).not.toContain("HAS NOT SPOKEN YET");
  });

  it("the mark stands BESIDE the overdue one, never instead of it", () => {
    const line = renderStatus(
      [view({ overdue: true, sessionLog: LOG })],
      new Set(),
      undefined,
      new Set([LOG]),
    );
    expect(line).toContain("⚠ OVERDUE");
    expect(line).toContain("HAS NOT SPOKEN YET");
  });
});

/**
 * THE PAIR IS OVER AND ITS SESSION IS NOT (thread 063, `save`; curator's three conditions of
 * 2026-09-02). The lock of the mail checkout is ONE PER BOX, a session writes its own memory
 * through it AFTER the handoff, and while that lasts the pair reads `released · completed`
 * next to a process that is holding every other delivery up.
 */
describe("renderStatus — the pair is over, its session is still inside the mail", () => {
  const lock = (over: Partial<HeldMailLock> = {}): HeldMailLock => ({
    pid: 4242,
    holder: "memory of dev-core",
    since: "2026-09-02T15:40:00Z",
    alive: true,
    ...over,
  });

  it("names the role the LOCK names, on that role's finished row", () => {
    const line = renderStatus(
      [view({ state: "released", reason: "completed" })],
      new Set(),
      undefined,
      new Set(),
      lock(),
    );
    expect(line).toContain("THIS PAIR IS OVER, ITS SESSION IS NOT");
    expect(line).toContain("pid 4242");
    expect(line).toContain("since 2026-09-02T15:40:00Z");
    // The error escapes the pair — that is the whole reason the mark exists.
    expect(line).toContain("every other delivery waits behind it");
  });

  it("condition 2: a lock of ANOTHER role is not pinned on the pair that happens to be here", () => {
    const line = renderStatus(
      [view({ state: "released", reason: "completed" })],
      new Set(),
      undefined,
      new Set(),
      lock({ holder: "memory of curator" }),
    );
    expect(line).not.toContain("THIS PAIR IS OVER, ITS SESSION IS NOT");
  });

  it("condition 2: a digest holds no pair, so the line names the DIGEST and no row is marked", () => {
    const line = renderStatus(
      [view({ state: "released", reason: "completed" })],
      new Set(),
      undefined,
      new Set(),
      lock({ holder: "digest of instance hetzner" }),
    );
    expect(line).not.toContain("THIS PAIR IS OVER, ITS SESSION IS NOT");
    expect(line).toContain("digest of instance hetzner");
    expect(line).toContain("belongs to no pair above");
  });

  it("condition 3: a record whose pid is GONE explains nothing — neither on a row nor beside it", () => {
    // The record outlives a killed process. A stale lock read as "held" would blame a
    // process that is not there for somebody else's slowness — a lie with a timestamp on it.
    const dead = renderStatus(
      [view({ state: "released", reason: "completed" })],
      new Set(),
      undefined,
      new Set(),
      lock({ alive: false }),
    );
    expect(dead).not.toContain("THIS PAIR IS OVER, ITS SESSION IS NOT");
    const orphanDead = renderStatus(
      [view({ state: "released", reason: "completed" })],
      new Set(),
      undefined,
      new Set(),
      lock({ holder: "digest of instance hetzner", alive: false }),
    );
    expect(orphanDead).not.toContain("belongs to no pair above");
  });

  it("a RUNNING row of the same role is left alone — there the process is doing its work", () => {
    const line = renderStatus([view({})], new Set(), undefined, new Set(), lock());
    expect(line).not.toContain("THIS PAIR IS OVER, ITS SESSION IS NOT");
  });

  it("and a free checkout changes no row at all", () => {
    const line = renderStatus([view({ state: "released", reason: "completed" })]);
    expect(line).not.toContain("ITS SESSION IS NOT");
    expect(line).not.toContain("mail checkout");
  });
});

/**
 * ONE PAIR WEARS THE LOCK, NOT ONE ROLE (thread 063, review of #201). A frame prints one row
 * per pair EVER seen in the journal, so a role that has worked five threads owns five rows,
 * and a mark matched on the role alone went onto all five at once: every long-dead pair of
 * that role told the operator that IT is the one holding the door. The other half of the same
 * defect was silence — a holder naming a role with no row here printed nothing anywhere, so a
 * busy checkout read exactly like a free one.
 */
describe("renderStatus — the mail lock belongs to ONE pair of the role", () => {
  const lock = (over: Partial<HeldMailLock> = {}): HeldMailLock => ({
    pid: 4242,
    holder: "memory of dev-core",
    since: "2026-09-02T15:40:00Z",
    alive: true,
    ...over,
  });
  const done = (thread: string, lastAt?: string): LeaseView =>
    view({
      thread,
      state: "released",
      reason: "completed",
      ...(lastAt === undefined ? {} : { lastAt }),
    });
  const MARK = "THIS PAIR IS OVER, ITS SESSION IS NOT";
  const marked = (frame: string): readonly string[] =>
    frame.split("\n").filter((line) => line.includes(MARK));

  it("two finished pairs of one role: the mark goes on the RECENT one and on it alone", () => {
    const frame = renderStatus(
      [
        done("010-ancient-thread", "2026-08-11T09:00:00Z"),
        done("063-state-model-rewrite", "2026-09-02T15:39:00Z"),
      ],
      new Set(),
      undefined,
      new Set(),
      lock(),
    );
    const hit = marked(frame);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toContain("063-state-model-rewrite");
    expect(frame).not.toContain("mail checkout is held by");
    // The ancient row keeps its own sentence and gains nothing about somebody's memory.
    const ancient = frame.split("\n").find((line) => line.includes("010-ancient-thread")) as string;
    expect(ancient).not.toContain(MARK);
  });

  it("the recent pair wins wherever it stands in the frame — order of rows is not recency", () => {
    const frame = renderStatus(
      [
        done("063-state-model-rewrite", "2026-09-02T15:39:00Z"),
        done("010-ancient-thread", "2026-08-11T09:00:00Z"),
      ],
      new Set(),
      undefined,
      new Set(),
      lock(),
    );
    expect(marked(frame)).toHaveLength(1);
    expect(marked(frame)[0]).toContain("063-state-model-rewrite");
  });

  it("a RUNNING pair of the role is no candidate: the finished one carries the mark", () => {
    const frame = renderStatus(
      [
        view({ thread: "079-live", lastAt: "2026-09-02T15:41:00Z" }),
        done("063-state-model-rewrite", "2026-09-02T15:39:00Z"),
      ],
      new Set(),
      undefined,
      new Set(),
      lock(),
    );
    expect(marked(frame)).toHaveLength(1);
    expect(marked(frame)[0]).toContain("063-state-model-rewrite");
  });

  it("the role has no row here at all — the fact is NOT lost, it is said as a line of its own", () => {
    // The whole point: the writer's pair may be outside this frame, and a live lock with a
    // named pid disappearing was indistinguishable from a free checkout.
    const frame = renderStatus(
      [view({ role: "curator", thread: "070-charter", state: "released", reason: "completed" })],
      new Set(),
      undefined,
      new Set(),
      lock(),
    );
    expect(marked(frame)).toHaveLength(0);
    expect(frame).toContain("the mail checkout is held by 'memory of dev-core'");
    expect(frame).toContain("pid 4242");
    expect(frame).toContain("every delivery waits behind it");
    // And it says WHY no row wears it, rather than refusing without a cause.
    expect(frame).toContain("no finished pair of 'dev-core' is in this frame");
  });

  it("every pair of the role is RUNNING — the same line, and it names that reason too", () => {
    const frame = renderStatus([view({})], new Set(), undefined, new Set(), lock());
    expect(marked(frame)).toHaveLength(0);
    expect(frame).toContain("no finished pair of 'dev-core' is in this frame");
  });

  it("two equally recent pairs: nothing is guessed, and the lock is still said out loud", () => {
    // Journal stamps are second-precision, so a tie is honest. Naming either row would be a
    // guess wearing the clothes of a measurement.
    const frame = renderStatus(
      [
        done("010-ancient-thread", "2026-09-02T15:39:00Z"),
        done("063-state-model-rewrite", "2026-09-02T15:39:00Z"),
      ],
      new Set(),
      undefined,
      new Set(),
      lock(),
    );
    expect(marked(frame)).toHaveLength(0);
    expect(frame).toContain("'dev-core' has 2 finished pairs here");
    expect(frame).toContain("do not say which of them is writing");
  });

  it("a hand-built frame with no stamps refuses to pick rather than taking the first row", () => {
    const frame = renderStatus(
      [done("010-ancient-thread"), done("063-state-model-rewrite")],
      new Set(),
      undefined,
      new Set(),
      lock(),
    );
    expect(marked(frame)).toHaveLength(0);
    expect(frame).toContain("the mail checkout is held by 'memory of dev-core'");
  });

  it("one finished pair of the role needs no stamp — there is nothing to choose between", () => {
    const frame = renderStatus(
      [done("063-state-model-rewrite"), view({ role: "curator", thread: "070-charter" })],
      new Set(),
      undefined,
      new Set(),
      lock(),
    );
    expect(marked(frame)).toHaveLength(1);
    expect(frame).not.toContain("mail checkout is held by");
  });
});
