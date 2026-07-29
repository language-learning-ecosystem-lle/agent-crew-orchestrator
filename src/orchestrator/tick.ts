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
 * ONE TICK = A PLAN, AT MOST ONE LAUNCH PER ROLE (D-1, thread `023-daemon-parallelism`).
 * It used to be one tick = one launch for the whole box, and that was the shape john
 * named as the thing to remove: "dev-core writes 016 while the curator workspace idles
 * on a waiting 019". The natural ceiling is the WORKSPACE — one per role (R17) — so the
 * degree of parallelism is the number of free roles, and the planner's job is to say
 * which pair each free role gets, in one pass, from one reading of the journal.
 *
 * The pure half lives here and the raising is the daemon's; since D-2 the whole plan is
 * raised in the tick that computed it, and the tick no longer waits for any of it. That
 * split is deliberate: the queue policy, the ceilings and "who drops out and why" are
 * decidable without a single child process, and they are the part that must not be
 * re-derived inside an event loop.
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
  consecutiveLaunchesWithoutDelivery,
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
 *
 * `role-busy` is the plural planner's own (D-1): the role ALREADY has a session — either
 * one planned earlier in this same tick, or one a supervisor of this daemon is still
 * running (D-2). It calls for nothing — the pair comes back on the next tick — but it is
 * not silence either: under a scalar `waiting-on` (024) one role is routinely awaited by
 * several threads, so this is the ordinary shape of a queue, and before D-1 those pairs
 * vanished from the stream with no line at all.
 *
 * D-2 MADE THIS REASON LOAD-BEARING ACROSS TICKS, not only within one. While the tick
 * blocked on its single launch, a role that was running could not be a candidate at all —
 * the daemon was not ticking. Now it ticks WHILE its children live, so the only thing
 * standing between a live session and a second one in the same workspace is that the
 * planner is told which roles are busy in this process (`running`).
 */
export type SkipReason = "held" | "active" | "waiting" | "exhausted" | "role-busy";

export type TickSkip = {
  readonly role: string;
  readonly thread: string;
  readonly reason: SkipReason;
  /** Failed attempts since the pair's last delivery — only meaningful for `exhausted`. */
  readonly attempt: number;
};

/** Everything the tick refused to raise, whatever it decided to do instead. */
type Skipped = { readonly skipped: readonly TickSkip[] };

/**
 * The tail of the plan the GLOBAL budget refused, and the one reason all of it shares.
 *
 * A budget is a count of launches, so N parallel raises spend N of it: the remainder is
 * read once per tick and takes the head of the plan, the rest is cut. ONE reason, ONE
 * journal record (`recorded` names it) — a tick that wrote a `launch-refused` per cut
 * pair would say the same sentence N times about a single ceiling, which is how a
 * journal of runs turns into a journal of the daemon complaining.
 */
export type TickCut = {
  readonly reason: RefusalReason;
  readonly candidates: readonly Candidate[];
  /** The pair the journal record is written against — the head of what was cut. */
  readonly recorded: Candidate;
};

export type TickDecisionKind =
  | { readonly kind: "halt" } // the stop flag — the emergency brake
  | { readonly kind: "disabled" } // switched off (no enable flag)
  | { readonly kind: "idle" } // nothing to launch
  // The only candidates are behind roles taken by manual sessions (S5). This is NOT
  // idle: "nothing to do" and "there is something to do, but the role is with a
  // human" are different states of the circuit, and the second one must be visible,
  // otherwise a forgotten hold looks like silence in the mailbox.
  | { readonly kind: "held"; readonly roles: readonly string[] }
  // THE PLAN OF THIS TICK: at most one pair per free role, in queue order, plus whatever
  // the global budget cut off the end of it. `launches` may be empty while `cut` is not —
  // that is the budget refusing the whole plan, and it is a different state from `idle`.
  | {
      readonly kind: "plan";
      readonly launches: readonly Candidate[];
      readonly cut?: TickCut;
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
  /**
   * Roles whose session a supervisor of THIS process is still running (D-2).
   *
   * It is not derivable from `events` in time: the lease of a run is written by the
   * supervisor, and between the decision to raise a pair and that write there is a whole
   * `settleRun` of git work. A tick landing in that window would read a journal with no
   * live lease and plan a second session into the same workspace — refused by the lock,
   * but refused with a burnt launch and a scary line instead of an ordinary queue skip.
   * The registry of live supervisors is the authority on this process; the journal
   * remains the authority on every other one.
   */
  readonly running?: readonly string[];
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

  // ONE PASS over the candidates: every one of them either enters the plan or leaves a
  // skip with its reason. Splitting "who is eligible" from "who was skipped and why"
  // into two passes is how the reasons drifted from the decision in the first place.
  const skipped: TickSkip[] = [];
  const eligible: Candidate[] = [];
  // Seeded with the roles this process is ALREADY running (D-2): "one session per role"
  // is one rule, and a role busy since an earlier tick is busy in exactly the same sense
  // as one taken by the head of this plan.
  const planned = new Set<string>(input.running ?? []);
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
    // ONE PAIR PER ROLE, and the ceiling is not a policy choice: the role has one
    // workspace (R17), and a second session in it is refused by the lock anyway. So the
    // planner refuses it HERE, by name, instead of raising a pair that would die on the
    // door. The pair is not lost — it is the next tick's head for that role.
    if (planned.has(candidate.role)) {
      skipped.push({ ...candidate, reason: "role-busy", attempt });
      continue;
    }
    eligible.push(candidate);
    planned.add(candidate.role);
  }

  if (eligible.length === 0) {
    // There is nothing to launch — but WHY depends on the holds: if there was work
    // and a human is holding it, the tick says so out loud.
    const heldWithWork = [
      ...new Set(skipped.filter((skip) => skip.reason === "held").map((skip) => skip.role)),
    ];
    return heldWithWork.length === 0
      ? { kind: "idle", skipped }
      : { kind: "held", roles: heldWithWork, skipped };
  }

  // THE GLOBAL CEILING — READ ONCE PER TICK, AND IT CUTS THE TAIL (D-1). It is a budget
  // of launches since anything last delivered, so a plan of N spends N of it: the
  // remainder takes the head of the plan and everything past it is cut with a single
  // reason. Computing it per pair instead would either let the whole plan through (each
  // pair sees the same pre-tick count and thinks itself the first) or write the same
  // refusal N times — the two ways a global ceiling stops being global.
  const remaining = Math.max(0, maxConsecutive - consecutiveLaunchesWithoutDelivery(input.events));
  const launches = eligible.slice(0, remaining);
  const cutCandidates = eligible.slice(remaining);
  const head = cutCandidates[0];
  return {
    kind: "plan",
    launches,
    ...(head === undefined
      ? {}
      : { cut: { reason: "run-budget" as const, candidates: cutCandidates, recorded: head } }),
    skipped,
  };
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
    case "role-busy":
      return `candidate ${pair} skipped: ${skip.role} already has a session (raised on an older thread of this tick, or still running from an earlier one) — one session per role (its workspace is one); this pair is first in line for ${skip.role} next tick`;
  }
};

/**
 * The plan of this tick in one line — what is being raised, and what the global budget
 * cut off the end of it.
 *
 * The cut is spoken as ONE line naming every pair in it, next to the single journal
 * record: an operator has to be able to tell "the box is busy" from "the box is refusing
 * to spend", and a budget refusal that only showed up once per tick in the journal while
 * three pairs quietly waited would read as the former.
 */
export const describePlan = (plan: {
  readonly launches: readonly Candidate[];
  readonly cut?: TickCut;
}): readonly string[] => {
  const pairs = (candidates: readonly Candidate[]): string =>
    candidates.map((c) => `${c.role}×${c.thread}`).join(", ");
  const lines: string[] = [];
  if (plan.launches.length > 0) {
    lines.push(
      `daemon — the plan of this tick: ${plan.launches.length} launch${plan.launches.length === 1 ? "" : "es"}, one per free role — ${pairs(plan.launches)}`,
    );
  }
  if (plan.cut !== undefined) {
    lines.push(
      `daemon — the global budget (${plan.cut.reason}) cut ${plan.cut.candidates.length} pair(s) off this plan: ${pairs(plan.cut.candidates)}; one refusal is recorded, against ${plan.cut.recorded.role}/${plan.cut.recorded.thread}`,
    );
  }
  return lines;
};
