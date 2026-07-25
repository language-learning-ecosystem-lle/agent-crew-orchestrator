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
 */

import type { OrchestratorEvent, RefusalReason } from "./journal.js";
import { consecutiveLaunchesWithoutCompletion, MAX_CONSECUTIVE_RUNS } from "./launch.js";
import { foldLeases } from "./lease.js";

/** A "role awaited on a thread" pair — a launch candidate (from `threadsWaitingOn`). */
export type Candidate = { readonly role: string; readonly thread: string };

export type TickDecision =
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

export const planTick = (input: {
  readonly enabled: boolean;
  readonly stopped: boolean;
  readonly events: readonly OrchestratorEvent[];
  readonly candidates: readonly Candidate[];
  readonly now: Date;
  readonly maxConsecutive?: number;
  /** Roles taken by manual sessions right now (S5, `heldRoles`). */
  readonly held?: readonly string[];
}): TickDecision => {
  const maxConsecutive = input.maxConsecutive ?? MAX_CONSECUTIVE_RUNS;
  const held = input.held ?? [];

  // The brake and the switch-off come BEFORE any launch decision (requirements 2
  // and 3). Stop overrides enabled: an emergency stop does not argue with state.
  if (input.stopped) return { kind: "halt" };
  if (!input.enabled) return { kind: "disabled" };

  // Roles taken by a human drop out ENTIRELY, not per pair: a hold holds the role,
  // not the thread — a manual dev-core session is busy with itself on any thread.
  // The other roles are launched as usual, hence a filter here rather than an exit.
  const free = input.candidates.filter((candidate) => !held.includes(candidate.role));
  const blocked = input.candidates.filter((candidate) => held.includes(candidate.role));

  // The first candidate that may be launched: the pair is neither active nor
  // exhausted. (Exhaustion is already in the journal through its own releases — we
  // do not spam a separate trace.)
  const views = foldLeases(input.events, input.now);
  const eligible = free.find((candidate) => {
    const view = views.find((v) => v.role === candidate.role && v.thread === candidate.thread);
    if (view && (view.state === "running" || view.state === "draining")) return false;
    if (view?.exhausted) return false;
    return true;
  });
  if (eligible === undefined) {
    // There is nothing to launch — but WHY depends on the holds: if there was work
    // and a human is holding it, the tick says so out loud.
    const heldWithWork = [...new Set(blocked.map((candidate) => candidate.role))];
    return heldWithWork.length === 0 ? { kind: "idle" } : { kind: "held", roles: heldWithWork };
  }

  // The global ceiling — with a trace (requirement 1): used up → a refusal, not a
  // launch.
  if (consecutiveLaunchesWithoutCompletion(input.events) >= maxConsecutive) {
    return { kind: "refused", role: eligible.role, thread: eligible.thread, reason: "run-budget" };
  }
  return { kind: "launch", role: eligible.role, thread: eligible.thread };
};
