/**
 * THE QUEUE ROW AND THE PLAN READ ONE FLAG — AND HAVE TO SEE ONE VALUE (thread 196).
 *
 * `⛔ OUT OF ATTEMPTS` on a queue row and `skipped: reason 'exhausted'` in the same tick are two
 * renderings of the same `LeaseView.exhausted`: the row through `spentCeilings` (`priority.ts`),
 * the skip through the tick's own fold (`tick.ts`, above the box ceiling and above the launch).
 * So a pair the row calls spent CANNOT be raised by that tick, and cannot be skipped by it for
 * any other reason either — that is the invariant, and the field broke it on 2026-09-13:
 * `.orchestrator/daemon.log` of `aco-hetzner`, window `14:49…15:18Z`, line 4127 promising
 * `curator×190-base-cost-dies-on-an-older-schema — ⛔ OUT OF ATTEMPTS — 9 of 3 … this row promises
 * no launch`, line 4154 of the same tick planning that very pair.
 *
 * The cause is not in either reader: it is the THIRD INPUT of the fold. The journal alone cannot
 * tell a run that delivered into its own turn from a run that broke — both are written down as
 * `exited-without-handoff`, and only the mail separates them (`isSelfTurnDelivery`, threads
 * 021/023). The tick has always been handed that mail; the daemon's row folded without it.
 *
 * This file pins the algebra of the two readings; the wiring of the daemon — that both calls are
 * now given ONE `deliveryMarks` and ONE `now` — is pinned across the seam by
 * `daemon.priority.process.test.ts` ("the queue row may not contradict the plan of its own tick").
 */
import { describe, expect, it } from "vitest";

import { marksOfSessions } from "../thread/index-doc.js";
import type { OrchestratorEvent } from "./journal.js";
import { foldLeases } from "./lease.js";
import { pairKey, spentCeilings } from "./priority.js";
import { type Candidate, planTick } from "./tick.js";

const NOW = new Date("2026-09-13T15:17:00Z");
const CEILING = 3;
const PAIR = { role: "curator", thread: "190-base-cost-dies-on-an-older-schema" } as const;
const CANDIDATES: Candidate[] = [{ ...PAIR }];

/**
 * A pair whose every run ENDED WITH THE TURN STILL ON IT — the shape of `waiting-on: <self>`,
 * which is the only legal way to carry a question that needs a person (thread 023). The journal
 * calls all nine of them `exited-without-handoff`; the mail says each one wrote its letter, and
 * a session id in the header is the sharp sign of that.
 */
const deliveredRuns = (count: number): OrchestratorEvent[] => {
  const events: OrchestratorEvent[] = [];
  for (let at = 0; at < count; at += 1) {
    const hour = String(at + 1).padStart(2, "0");
    events.push(
      {
        kind: "lease-acquired",
        ts: `2026-09-13T${hour}:00:00Z`,
        deadline: `2026-09-13T${hour}:30:00Z`,
        ...PAIR,
      },
      {
        kind: "lease-released",
        ts: `2026-09-13T${hour}:20:00Z`,
        reason: "exited-without-handoff",
        exitCode: 0,
        session: `s-${at}`,
        ...PAIR,
      },
    );
  }
  return events;
};

/** The mail of those runs: every one of them is named by a `session:` header somewhere. */
const marksOf = (count: number) =>
  marksOfSessions(new Set(Array.from({ length: count }, (_, at) => `s-${at}`)));

/** The row's own reading — `spentCeilings` is the only source the queue line has. */
const rowSaysSpent = (events: readonly OrchestratorEvent[], marks = marksOf(0)): boolean =>
  spentCeilings(foldLeases(events, NOW, CEILING, marks)).has(pairKey(PAIR.role, PAIR.thread));

/** The tick's own reading, off the same three inputs — what it did with the pair. */
const tickSays = (
  events: readonly OrchestratorEvent[],
  marks = marksOf(0),
): { readonly raised: boolean; readonly skips: readonly string[] } => {
  const decision = planTick({
    enabled: true,
    stopped: false,
    events,
    candidates: CANDIDATES,
    now: NOW,
    maxAttempts: CEILING,
    deliveryMarks: marks,
  });
  return {
    raised:
      decision.kind === "plan" &&
      decision.launches.some((c) => c.role === PAIR.role && c.thread === PAIR.thread),
    skips: decision.skipped
      .filter((skip) => skip.role === PAIR.role && skip.thread === PAIR.thread)
      .map((skip) => skip.reason),
  };
};

describe("the row that says OUT OF ATTEMPTS and the tick that plans (thread 196)", () => {
  it("nine breaks that DELIVERED are spent for neither reader — the field case, both sides", () => {
    const events = deliveredRuns(9);
    const marks = marksOf(9);

    // The row: no `⛔ OUT OF ATTEMPTS`, which is what line 4127 printed on 2026-09-13.
    expect(rowSaysSpent(events, marks)).toBe(false);
    // The tick: the pair is raised, which is what line 4154 of that same tick did.
    expect(tickSays(events, marks)).toEqual({ raised: true, skips: [] });
  });

  it("WITHOUT the mail the row alone flips — the exact defect, named as the third input", () => {
    const events = deliveredRuns(9);

    // This is the daemon's old call: `foldLeases(events, now, maxAttempts)` and nothing more.
    // Same journal, same instant, same ceiling — and the opposite answer about the same pair.
    expect(rowSaysSpent(events)).toBe(true);
    // While the tick, given the mail, raises it in that very tick. Two readers, one flag.
    expect(tickSays(events, marksOf(9)).raised).toBe(true);
  });

  it("and a pair that REALLY spent its ceiling is spent for both — the invariant, not a mute", () => {
    // The same nine runs with no mail behind them at all: nobody delivered, and the ceiling is
    // honestly closed. A fix that merely stopped the row from ever saying the sentence would
    // pass the two tests above and fail this one.
    const events = deliveredRuns(9);
    const marks = marksOfSessions(new Set());

    expect(rowSaysSpent(events, marks)).toBe(true);
    expect(tickSays(events, marks)).toEqual({ raised: false, skips: ["exhausted"] });
  });

  it("the invariant itself: raised or skipped-for-another-reason ⟹ the row does not say it", () => {
    // Read as the operator reads the two lines, over every count from 'fresh' to 'well past the
    // ceiling' and both with and without the mail: whatever the tick did with the pair, the row
    // of that tick may not contradict it.
    for (const runs of [0, 1, 3, 4, 9]) {
      for (const delivered of [true, false]) {
        const events = deliveredRuns(runs);
        const marks = delivered ? marksOf(runs) : marksOfSessions(new Set());
        const tick = tickSays(events, marks);
        const spent = rowSaysSpent(events, marks);
        const shape = `${runs} run(s), delivered=${delivered}`;

        if (spent) {
          // The row's sentence is absolute ("this row promises no launch; nothing lifts it by
          // itself"). Then the tick may only have skipped it, and only for THIS reason.
          expect({ shape, raised: tick.raised, skips: tick.skips }).toEqual({
            shape,
            raised: false,
            skips: ["exhausted"],
          });
        } else {
          // And the other way: a pair the tick raised, or held back for a reason of its own,
          // may not be wearing the sentence on its queue row.
          expect({ shape, exhaustedSkip: tick.skips.includes("exhausted") }).toEqual({
            shape,
            exhaustedSkip: false,
          });
        }
      }
    }
  });
});
