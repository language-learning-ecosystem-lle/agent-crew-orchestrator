/**
 * THE EMERGENCY VALVE ASKS THE PLANNER'S OWN QUESTIONS (thread `177-workspace-per-pair`,
 * §3.4 of the statement of work; john's word of 2026-09-08 — "the manual launch returns").
 *
 * `orchestrator run --role R --thread T --write` is the launch a human types: it raises
 * EXACTLY the named pair rather than the head of a queue, and that is the whole reason it
 * exists — two pairs of one role cannot otherwise be put up side by side except by waiting
 * for the planner to happen to do it. What it did NOT do until this file is ask the six
 * questions the planner asks before raising anything, and that hole opened at the moment
 * the workspace was keyed by the pair:
 *
 *  - while the place was one per role (R17), a second session of a role met the WORKSPACE
 *    LOCK and was refused by it. The lock was the ceiling, so a hand-typed run could not
 *    exceed it even in principle;
 *  - since the place is `<role>@<thread>` the two sessions have two trees, the lock sees
 *    neither of them twice, and a hand-typed run walks straight past `parallelism.pairsPerRole`
 *    and `parallelism.pairsPerInstance` — the two numbers john pressed the button on (#356).
 *
 * So the valve is not "a launch with an override": it is the planner's gate asked about ONE
 * NAMED PAIR. It is implemented by CALLING `planTick` with a single candidate rather than by
 * re-deciding anything here, and that is the point — the statement of work says the manual
 * launch must ask the ceilings, the lease, the hold, the park and the account's window "the
 * same way the planner does", and the only way to make that true a year from now is for it to
 * be the same function. A second copy of those conditions would be a second opinion about a
 * ceiling, and this repository has paid for divergence between the door a human types and the
 * door the daemon walks through more than once (the ownership door of R13 is doubled for the
 * same reason, and in the same words: "a manual run is the way around the topology, and it is
 * typed exactly when something is already wrong").
 *
 * WHAT THIS DOOR DOES **NOT** DECIDE, on purpose:
 *
 *  1. `enabled` and `stopped` — the daemon's switch and its brake. They are the flags of the
 *     autonomous loop, and the valve's whole use is the state where that loop is off or is
 *     being repaired; a valve that required the enable flag would be shut precisely when a
 *     hand reaches for it. They are passed as "on, not stopped" and the refusals they produce
 *     can therefore never come out of here;
 *  2. the GLOBAL run budget (`--max-runs`) and the pair's attempt ceiling — those are
 *     `planLaunch`'s, which every run already goes through a few lines later and which refuses
 *     them BY NAME (`run-budget`, `exhausted`). The attempt ceiling is also the one condition a
 *     hand is documented to lift (`orchestrator run --max-attempts <ceiling+1>` is the single
 *     move that thaws a substantive freeze — `freeze-letter.ts`), so the number it is asked
 *     against travels in from the flags and is not re-derived here.
 *
 * WHO IS LIVE COMES FROM THE JOURNAL, not from a registry of supervisors. The daemon knows its
 * own children in memory (`running`); a hand-typed run is a different process and can only know
 * what the journal says — `unclosedLeases`, the same fold `status` prints the live pairs from.
 * A lease left open by a session that died is therefore counted as a place taken, which is the
 * honest answer and the one the refusal is built to explain: it names the occupants WITH THE
 * TIME each was raised, so "the ceiling is full" and "the ceiling is stuck behind a corpse" are
 * told apart by the reader without a second command.
 */

import type { PairCeilings } from "../config/config.js";
import type { DeliveryMarks } from "../thread/index-doc.js";
import type { DeclaredAccount } from "./failover.js";
import type { OrchestratorEvent } from "./journal.js";
import type { AgentKind } from "./kind.js";
import type { Ceiling } from "./launch.js";
import { isLeaseAlive, type LeaseView } from "./lease.js";
import { type Candidate, describeSkip, planTick, type RunningPair, type TickSkip } from "./tick.js";

/**
 * The verdict of the valve on one named pair: either the planner would raise it, or here is
 * the skip it would have left, with every field its own refusal line needs (the ceiling that
 * was full, the occupants holding it, whom the thread is parked behind).
 */
export type ValveVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: TickSkip };

/**
 * The live pairs of this box as the journal knows them — the `running` the planner is handed
 * in a process that has no children of its own.
 *
 * `since` is the stamp the lease was ACQUIRED at and it is what makes the ceiling refusal
 * actionable rather than merely true; `lastAt` is the closest the fold hands back to it (the
 * last event of a live pair is its launch until something else happens to it).
 */
export const livePairsOf = (views: readonly LeaseView[]): RunningPair[] =>
  views
    .filter((view) => isLeaseAlive(view.state))
    .map((view) => ({
      role: view.role,
      thread: view.thread,
      // ABSENT WHEN THE FOLD HAS NO STAMP FOR IT, never invented: `describeOccupants` says the
      // pair without a time in that case, which is the honest half of the sentence. A `since`
      // guessed from `now` would make a lease of unknown age read as one taken this second.
      ...(view.lastAt === undefined || view.lastAt === null ? {} : { since: view.lastAt }),
    }));

/**
 * Would the planner raise this pair right now? The inputs are the planner's own, minus the
 * two flags named in the header — every one of them is read by the caller from the same place
 * the daemon reads it, and none of them is derived twice.
 */
export const valveVerdict = (input: {
  readonly role: string;
  readonly thread: string;
  readonly events: readonly OrchestratorEvent[];
  readonly now: Date;
  /** Live pairs of the whole box, from {@link livePairsOf}. */
  readonly running: readonly RunningPair[];
  readonly ceilings: PairCeilings;
  /** Roles taken by a live manual session (`heldRoles`). */
  readonly held?: readonly string[];
  /** Threads frozen behind a person or an event (`parkedThreads`). */
  readonly parked?: ReadonlyMap<string, string>;
  readonly modeParked?: ReadonlySet<string>;
  readonly deliveryMarks?: DeliveryMarks;
  readonly maxAttempts?: number;
  readonly maxConsecutive?: number;
  /** What this pair would spend and what its spares are (`roleAccountChains`). */
  readonly chain?: Pick<Candidate, "account" | "fallback" | "worker">;
  readonly accounts?: Readonly<Record<string, DeclaredAccount>>;
}): ValveVerdict => {
  const candidate: Candidate = { role: input.role, thread: input.thread, ...(input.chain ?? {}) };
  const decision = planTick({
    // THE TWO FLAGS OF THE LOOP ARE NOT ASKED HERE — see point 1 of the header. Written as
    // literals rather than read from the disk so that the one thing this file must never do
    // (refuse a hand because the daemon is off) cannot be introduced by a caller.
    enabled: true,
    stopped: false,
    candidates: [candidate],
    events: input.events,
    now: input.now,
    running: input.running,
    ceilings: input.ceilings,
    ...(input.held === undefined ? {} : { held: input.held }),
    ...(input.parked === undefined ? {} : { parked: input.parked }),
    ...(input.modeParked === undefined ? {} : { modeParked: input.modeParked }),
    ...(input.deliveryMarks === undefined ? {} : { deliveryMarks: input.deliveryMarks }),
    ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
    ...(input.maxConsecutive === undefined ? {} : { maxConsecutive: input.maxConsecutive }),
    ...(input.accounts === undefined ? {} : { accounts: input.accounts }),
  });
  // ONE CANDIDATE IN, SO AT MOST ONE SKIP OUT — whatever kind the decision came back as. The
  // `quota` and `auth` decisions carry their pair in `skipped` exactly as `plan` does, so the
  // refusal is read from the one place instead of from a switch over the four kinds, which is
  // how a fifth kind added later would go quiet here.
  const refusal = decision.skipped[0];
  if (refusal !== undefined) return { ok: false, refusal };
  // A PAIR CUT BY THE GLOBAL BUDGET IS NOT REFUSED HERE (point 2 of the header): `planLaunch`
  // asks that ceiling of every run, manual or not, and answers it by name. Saying it twice in
  // two sentences would be two doors with one job — and the second of them would be the one
  // nobody maintains.
  return { ok: true };
};

/**
 * The refusal in one line, for the terminal of whoever typed the command.
 *
 * The sentence is the PLANNER'S OWN (`describeSkip`) with the valve named in front of it, and
 * that is deliberate: the ceiling, the occupants with their times, the way a park lifts and the
 * command that thaws a frozen pair are all already written there, once, and an operator who has
 * read the daemon's stream reads exactly the same words here. A second wording of "the ceiling of
 * dev-core is full" would be the drift between the two doors in the only form that matters — the
 * one the reader acts on.
 */
export const describeValveRefusal = (
  refusal: TickSkip,
  ceiling: Ceiling,
  kind?: AgentKind,
): string =>
  `the manual launch of '${refusal.role}×${refusal.thread}' is refused ('${refusal.reason}') — it asks the planner's gate and does not go around it: ${describeSkip(refusal, ceiling, kind)}`;
