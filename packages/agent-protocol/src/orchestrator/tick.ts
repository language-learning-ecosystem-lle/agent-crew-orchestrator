/**
 * The decision of one daemon tick — the pure core of step S3 (thread 012). Before
 * S3 a human closed the loop; here the orchestrator decides on its own, so the
 * design is built around "what if nobody is watching".
 *
 * The three requirements of curator (msg 15:25) are closed here by construction:
 *  1. the global ceiling IS WRITTEN to the journal: `run-budget` used up → the
 *     decision is `refused` and the daemon leaves a `launch-refused` trace (it does
 *     not burn quota silently);
 *  2. the starting state is OFF: `enabled=false` → `disabled`, not a single launch;
 *     the first autonomous launch will not happen by accident;
 *  3. the emergency brake: `stopped=true` (the stop flag file) → `halt`, which
 *     overrides being enabled; checked BEFORE every launch.
 *
 * One tick = one decision = at most one launch: the daemon raises a pair, waits
 * for its terminal (the S2 observer) and ticks again. That way the ceiling and the
 * leases are computed from a fresh journal, without races inside a tick.
 *
 * S5 added a fourth guard — `held`: a role taken by a LIVE MANUAL SESSION drops
 * out of the candidates, otherwise the daemon would raise a second session of the
 * same role on top of the working one (curator's statement of work, 20:25). The
 * mechanics of a hold are in `hold.ts`.
 *
 * NOTHING DROPS OUT SILENTLY (curator's defect report, 2026-07-26, requirement 1).
 * Every candidate the tick refuses to raise comes back in `skipped` with its reason,
 * and the daemon says each one out loud. Before that, a candidate filtered out here
 * produced a bare `idle`, so a daemon whose only role was `exhausted` printed its
 * banner and exited without a word — from the outside indistinguishable from "no
 * mail". A silent non-start is the same class of failure as a silent death, only at
 * the entrance.
 */

import type { OrchestratorEvent, RefusalReason } from "./journal.js";
import {
  type Ceiling,
  consecutiveLaunchesWithoutCompletion,
  MAX_CONSECUTIVE_RUNS,
} from "./launch.js";
import { foldLeases, isLeaseAlive, type LeaseView } from "./lease.js";

/** A "role awaited on a thread" pair — a launch candidate (from `threadsWaitingOn`). */
export type Candidate = { readonly role: string; readonly thread: string };

/**
 * Why a candidate was not raised on this tick. Three reasons, and they call for
 * four different things from a human: `held` — wait for the manual session to end;
 * `active` — nothing, the pair is being worked on right now; `waiting` — ANSWER, the
 * session is parked on a question of its own (R19); `exhausted` — look at the journal,
 * the pair has been failing without delivering.
 *
 * `waiting` is told apart from `active` because those are the two ends of the same
 * silence: an `active` pair needs nothing from anybody, a parked one is blocked on a
 * human and will die on its wait ceiling if the line reads "running right now" and the
 * operator does what that line implies — namely, nothing.
 */
export type SkipReason = "held" | "active" | "waiting" | "exhausted";

export type TickSkip = {
  readonly role: string;
  readonly thread: string;
  readonly reason: SkipReason;
  /** Failed attempts since the pair's last delivery — only meaningful for `exhausted`. */
  readonly attempt: number;
};

/** Everything the tick refused to raise, whatever it decided to do instead. */
type Skipped = { readonly skipped: readonly TickSkip[] };

export type TickDecisionKind =
  | { readonly kind: "halt" } // the stop flag — the emergency brake
  | { readonly kind: "disabled" } // switched off (no enable flag)
  | { readonly kind: "idle" } // nothing to launch
  // The only candidates are behind roles taken by manual sessions (S5). This is NOT
  // idle: "nothing to do" and "there is something to do, but the role is with a
  // human" are different states of the circuit, and the second one must be visible,
  // otherwise a forgotten hold looks like silence in the mailbox.
  | { readonly kind: "held"; readonly roles: readonly string[] }
  | { readonly kind: "launch"; readonly role: string; readonly thread: string }
  | {
      readonly kind: "refused";
      readonly role: string;
      readonly thread: string;
      readonly reason: RefusalReason;
    };

export type TickDecision = TickDecisionKind & Skipped;

export const planTick = (input: {
  readonly enabled: boolean;
  readonly stopped: boolean;
  readonly events: readonly OrchestratorEvent[];
  readonly candidates: readonly Candidate[];
  readonly now: Date;
  readonly maxConsecutive?: number;
  /** The per-pair attempt ceiling — an operator's flag since the 2026-07-26 defect. */
  readonly maxAttempts?: number;
  /** Roles taken by manual sessions right now (S5, `heldRoles`). */
  readonly held?: readonly string[];
}): TickDecision => {
  const maxConsecutive = input.maxConsecutive ?? MAX_CONSECUTIVE_RUNS;
  const held = input.held ?? [];

  // The brake and the switch-off come BEFORE any launch decision (requirements 2
  // and 3). Stop overrides enabled: an emergency stop does not argue with state.
  // Neither looks at the candidates at all, so neither has anything to skip.
  if (input.stopped) return { kind: "halt", skipped: [] };
  if (!input.enabled) return { kind: "disabled", skipped: [] };

  // Roles taken by a human drop out ENTIRELY, not per pair: a hold holds the role,
  // not the thread — a manual dev-core session is busy with itself on any thread.
  // The other roles are launched as usual, hence a filter here rather than an exit.
  const views = foldLeases(input.events, input.now, input.maxAttempts);
  const viewOf = (candidate: Candidate): LeaseView | undefined =>
    views.find((v) => v.role === candidate.role && v.thread === candidate.thread);

  // ONE PASS over the candidates: every one of them either becomes THE eligible one
  // or leaves a skip with its reason. Splitting "who is eligible" from "who was
  // skipped and why" into two passes is how the reasons drifted from the decision in
  // the first place.
  const skipped: TickSkip[] = [];
  let eligible: Candidate | undefined;
  for (const candidate of input.candidates) {
    const view = viewOf(candidate);
    const attempt = view?.attempt ?? 0;
    if (held.includes(candidate.role)) {
      skipped.push({ ...candidate, reason: "held", attempt });
      continue;
    }
    // A live lease takes the pair out — including a PARKED one (R19): a session waiting
    // for input becomes a candidate again the instant its answer lands, and that is the
    // one tick where launching would put a second session on top of a live one. Hence
    // `isLeaseAlive` and not two comparisons — a third live state added later would
    // otherwise have to be remembered here as well. The REASON, though, is split: both
    // states forbid a launch, and only one of them asks a human for something.
    if (view && isLeaseAlive(view.state)) {
      const reason = view.state === "waiting" ? "waiting" : "active";
      skipped.push({ ...candidate, reason, attempt });
      continue;
    }
    if (view?.exhausted) {
      skipped.push({ ...candidate, reason: "exhausted", attempt });
      continue;
    }
    // The FIRST suitable pair is launched and the rest of the tick is over — but the
    // loop runs to the end anyway, so the pairs behind it are still accounted for
    // rather than vanishing into "we stopped looking".
    if (eligible === undefined) eligible = candidate;
  }

  if (eligible === undefined) {
    // There is nothing to launch — but WHY depends on the holds: if there was work
    // and a human is holding it, the tick says so out loud.
    const heldWithWork = [
      ...new Set(skipped.filter((skip) => skip.reason === "held").map((skip) => skip.role)),
    ];
    return heldWithWork.length === 0
      ? { kind: "idle", skipped }
      : { kind: "held", roles: heldWithWork, skipped };
  }

  // The global ceiling — with a trace (requirement 1): used up → a refusal, not a
  // launch.
  if (consecutiveLaunchesWithoutCompletion(input.events) >= maxConsecutive) {
    return {
      kind: "refused",
      role: eligible.role,
      thread: eligible.thread,
      reason: "run-budget",
      skipped,
    };
  }
  return { kind: "launch", role: eligible.role, thread: eligible.thread, skipped };
};

/**
 * A skip in one line, for the daemon's stream. The ceiling is passed WITH ITS SOURCE
 * (R12): "exhausted, ceiling 3" leaves an operator guessing whether their
 * `--max-attempts` arrived, which is precisely how `--max-runs` looked while it was
 * being ignored.
 */
export const describeSkip = (skip: TickSkip, ceiling: Ceiling): string => {
  const pair = `${skip.role}×${skip.thread}`;
  switch (skip.reason) {
    case "held":
      return `candidate ${pair} skipped: held by a manual session of ${skip.role}`;
    case "active":
      return `candidate ${pair} skipped: the pair is running right now`;
    case "waiting":
      return `candidate ${pair} skipped: the session is parked on a question of its own (R19) — it is waiting for an ANSWER, not for a launch; see 'orchestrator status' for the ceiling of that wait`;
    case "exhausted":
      return `candidate ${pair} skipped: exhausted — ${skip.attempt} failed attempts since its last delivery, ceiling ${ceiling.value} (${ceiling.source}); see 'orchestrator status' and the journal`;
  }
};
