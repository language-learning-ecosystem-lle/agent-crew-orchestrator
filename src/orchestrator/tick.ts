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

import { parkedOnKind } from "../thread/thread.js";
import { type AuthShelf, authRefusalRecorded, authShelfAgainst, openAuthShelves } from "./auth.js";
import type { OrchestratorEvent, RefusalReason } from "./journal.js";
import {
  type Ceiling,
  consecutiveLaunchesWithoutDelivery,
  MAX_CONSECUTIVE_RUNS,
} from "./launch.js";
import { foldLeases, isLeaseAlive, type LeaseView } from "./lease.js";
import {
  openQuotaShelves,
  type QuotaShelf,
  quotaRefusalRecorded,
  shelvesAgainst,
} from "./quota.js";

/** A "role awaited on a thread" pair — a launch candidate (from `threadsWaitingOn`). */
export type Candidate = {
  readonly role: string;
  readonly thread: string;
  /**
   * WHOSE ACCOUNT THIS PAIR WOULD SPEND (thread 055, B.3) — the id as the repository names
   * it, absent for the box's own. It is the planner's business because the two shelves
   * below are the account's and not the box's: without it a window closed on one
   * subscription stands down the roles of another, which is the stall the backoff exists
   * to remove. Absent is a KEY, not a gap — see `BOX_ACCOUNT`.
   */
  readonly account?: string;
};

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
 * `parked` is the same silence as `waiting`, with the session gone (R27): the turn is on the
 * role, but the role's question is with a PERSON, said in the feed (`parked-on`). It calls for
 * the same thing `waiting` calls for — an answer — and for the same reason must not read as
 * `idle`: raising the pair would spend a session on re-reading a question nobody has answered
 * yet, and three of those used to exhaust the pair for obeying the norm.
 *
 * D-2 MADE THIS REASON LOAD-BEARING ACROSS TICKS, not only within one. While the tick
 * blocked on its single launch, a role that was running could not be a candidate at all —
 * the daemon was not ticking. Now it ticks WHILE its children live, so the only thing
 * standing between a live session and a second one in the same workspace is that the
 * planner is told which roles are busy in this process (`running`).
 *
 * `quota` and `auth` are the two reasons here that belong to INFRASTRUCTURE rather than to
 * the pair (D-3 part 2, thread 023). They call for nothing from the pair — a window ends by
 * the clock, credentials end when a human logs in — but they must be said, because a
 * circuit standing down for hours with no line on the stream is indistinguishable from a
 * circuit that died.
 *
 * THE INFRASTRUCTURE THEY BELONG TO IS THE ACCOUNT'S, NOT THE BOX'S (thread 055, B.3).
 * While a box had one subscription the two were the same sentence and this block said
 * "the box"; since B.2 a box may raise its roles on several, and each has its own window
 * and its own token. So both reasons are decided per candidate against the shelves of the
 * account THAT candidate would spend, and neither is a state of the box any more: a tick
 * that can still raise somebody raises them and merely SAYS the rest were shelved.
 */
export type SkipReason =
  | "held"
  | "active"
  | "waiting"
  | "exhausted"
  | "role-busy"
  | "parked"
  | "quota"
  | "auth";

export type TickSkip = {
  readonly role: string;
  readonly thread: string;
  readonly reason: SkipReason;
  /** Failed attempts since the pair's last delivery — only meaningful for `exhausted`. */
  readonly attempt: number;
  /** Whose decision the thread is frozen behind — only meaningful for `parked` (R27). */
  readonly parkedOn?: string;
  /**
   * WHOSE ACCOUNT THE SKIPPED PAIR WOULD HAVE SPENT (thread 055, B.3) — copied off the
   * candidate by the spread that builds every skip, and declared here so the two folds
   * below can read it DIRECTLY instead of going back to `input.candidates` for the pair
   * they already hold. A lookup by (role, thread) is a lookup that can miss; the field
   * cannot. Absent is a KEY, not a gap — see `BOX_ACCOUNT`.
   */
  readonly account?: string;
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
  // THE WINDOW IS CLOSED (D-3 part 2) — nobody is raised, and the reason is neither
  // "nothing to do" nor a fault of any pair. Its own kind for the same reason `held` has
  // one: the operator's question in front of a silent contour is WHY, and "the five-hour
  // window reopens at 21:40" is an answer with a clock on it. `cut` is present only on
  // the FIRST tick of a shelf — one shelf, one journal record.
  | {
      readonly kind: "quota";
      readonly shelves: readonly QuotaShelf[];
      readonly cut?: TickCut;
    }
  // THE BOX CANNOT AUTHENTICATE (thread 023, the OAuth episode of 2026-08-01). Its own
  // kind beside `quota` and never folded into it: both stand the whole box down, and the
  // operator in front of a silent circuit needs the two apart — a window reopens by the
  // vendor's clock and wants nothing from anybody, dead credentials want a human to run
  // `claude login` here and reopen by nothing else. `cut` is present only on the FIRST
  // tick of a shelf — one shelf, one journal record.
  | {
      readonly kind: "auth";
      readonly shelf: AuthShelf;
      readonly cut?: TickCut;
    }
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
  /**
   * Threads FROZEN BEHIND A PERSON right now (R27) — thread id → whom it waits for, from
   * `parkedOnOf` over the same mail the candidates come from.
   *
   * A map rather than a set because the reason is worth saying by name: "parked behind john"
   * tells an operator whose hand the queue is in, and that is the whole point of the state
   * being visible instead of the pair quietly failing three times.
   */
  readonly parked?: ReadonlyMap<string, string>;
  /**
   * Sessions that wrote a message into the mail — the differentiator of a run that
   * DELIVERED into its own turn (`isSelfTurnDelivery`, thread 023). The tick reads the
   * threads anyway to build its candidates, so the set costs it nothing; without it the
   * fold judges by the journal alone and counts such a run a failed attempt.
   */
  readonly deliveredSessions?: ReadonlySet<string>;
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
  const views = foldLeases(input.events, input.now, input.maxAttempts, input.deliveredSessions);
  const viewOf = (candidate: Candidate): LeaseView | undefined =>
    views.find((v) => v.role === candidate.role && v.thread === candidate.thread);

  // ONE PASS over the candidates: every one of them either enters the plan or leaves a
  // skip with its reason. Splitting "who is eligible" from "who was skipped and why"
  // into two passes is how the reasons drifted from the decision in the first place.
  // THE SHELF IS READ ONCE PER TICK, LIKE THE GLOBAL BUDGET, and for the same reason: it
  // is one fact about the box, not a fact per pair. It is a fold of the very events the
  // ceilings are folded from, so a closed window cannot be true for the planner and
  // false for the operator's frame.
  const shelves = openQuotaShelves(input.events, input.now);
  // THE CREDENTIALS SHELF IS READ IN THE SAME BREATH AND FOR THE SAME REASON — one fact
  // about the box, folded out of the events the ceilings are folded from.
  const authShelves = openAuthShelves(input.events, input.now);
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
    // FROZEN BEHIND A PERSON (R27) — and this is checked BEFORE `exhausted` on purpose: a pair
    // that already burnt its attempts on this very freeze is better described by the thing that
    // is actually blocking it than by the damage that did. The freeze also costs nothing: no
    // launch, so no attempt, so the counter stands still while the person thinks.
    const parkedOn = input.parked?.get(candidate.thread);
    if (parkedOn !== undefined) {
      skipped.push({ ...candidate, reason: "parked", attempt, parkedOn });
      continue;
    }
    if (view?.exhausted) {
      skipped.push({ ...candidate, reason: "exhausted", attempt });
      continue;
    }
    // THE CLOSED WINDOW COMES BEFORE `role-busy` and after everything that is about the
    // PAIR: a candidate the box could not raise anyway is better named by the reason it
    // could not be raised at all than by its place in a queue that is not moving.
    // …AND THE WINDOW THAT COUNTS IS THIS CANDIDATE'S ACCOUNT'S (B.3), never any closed
    // window of the box: on a machine raising roles on two subscriptions the second reading
    // stands a healthy account down for the five hours of a neighbour's.
    if (shelvesAgainst(shelves, candidate.account).length > 0) {
      skipped.push({ ...candidate, reason: "quota", attempt });
      continue;
    }
    // THE REFUSED CREDENTIALS SIT BESIDE THE CLOSED WINDOW, and after it: when both are
    // true the window is the fact with a clock on it, and a box that cannot authenticate
    // will say so again the moment the window reopens.
    if (authShelfAgainst(authShelves, candidate.account) !== undefined) {
      skipped.push({ ...candidate, reason: "auth", attempt });
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

  // A CLOSED WINDOW WITH WORK BEHIND IT IS ITS OWN STATE, not `idle`. The journal record
  // is written against the head of what the shelf refused, once per DARK SPELL of the box
  // and not once per window: the ceiling is the box's and it was read once, so it produces
  // one line, exactly as the global budget does — `every` here is what makes two windows
  // closing before the first line share that line (see `quotaRefusalRecorded`) — while the
  // daemon's stream repeats it every tick, which is where repetition belongs.
  const refusedByQuota = skipped.filter((skip) => skip.reason === "quota");
  const quotaHead = refusedByQuota[0];
  // THE SHELVES NAMED IN THE DECISION ARE THE ONES THAT REFUSED THE HEAD (B.3), exactly
  // as the credentials half below names the shelf its own head met. Two things were wrong
  // with handing back every shelf of the box: the operator's answer to "why is nothing
  // happening" would name the closed window of an account the head never spends, and the
  // `every` fold — the thing that keeps ONE line per dark spell — would turn false on a
  // neighbour's fresh shelf and write that line against a head whose own period was
  // announced hours ago. Both are the stall B.3 removes, only wearing the wrong label.
  const quotaShelves = shelvesAgainst(shelves, quotaHead?.account);
  // AND IT IS A STATE OF THE BOX, so it is only the ANSWER while the box has nothing else
  // to do (B.3). Before the shelves were per account this guard was implied: one closed
  // window refused every candidate, so a shelf and an empty plan were the same fact. With
  // two subscriptions they are not — a window closed on `main` leaves the roles of
  // `second` perfectly raisable, and returning `quota` there would stand the healthy
  // account down for the neighbour's five hours, which is the whole stall B.3 removes.
  // The refused pairs are not lost: they are in `skipped`, and the daemon says every one
  // of them out loud every tick. What they do NOT get is the `launch-refused` line — its
  // sentence is "nothing was launched", and on this tick something was.
  if (eligible.length === 0 && quotaShelves.length > 0 && quotaHead !== undefined) {
    const announced = quotaShelves.every((shelf) => quotaRefusalRecorded(input.events, shelf));
    return {
      kind: "quota",
      shelves: quotaShelves,
      ...(announced
        ? {}
        : {
            cut: {
              reason: "quota" as const,
              candidates: refusedByQuota.map((skip) => ({ role: skip.role, thread: skip.thread })),
              recorded: { role: quotaHead.role, thread: quotaHead.thread },
            },
          }),
      skipped,
    };
  }

  // THE SAME SHAPE AS THE CLOSED WINDOW ABOVE, one shelf instead of many: the record is
  // written against the head of what was refused, once per SHELF and not once per tick
  // (`authRefusalRecorded`), while the daemon's stream repeats it every tick.
  const refusedByAuth = skipped.filter((skip) => skip.reason === "auth");
  const authHead = refusedByAuth[0];
  // THE SHELF NAMED IN THE DECISION IS THE ONE THAT REFUSED THE HEAD (B.3): several
  // accounts may be shelved at once, and a decision naming a shelf the head never met
  // would explain the stall with somebody else's dead token.
  const authShelf =
    authHead === undefined ? undefined : authShelfAgainst(authShelves, authHead.account);
  // The same guard as the window's above, for the same reason and in the same words:
  // dead credentials of one account are not a state of a box that can still raise the
  // roles of another.
  if (eligible.length === 0 && authShelf !== undefined && authHead !== undefined) {
    return {
      kind: "auth",
      shelf: authShelf,
      ...(authRefusalRecorded(input.events, authShelf)
        ? {}
        : {
            cut: {
              reason: "auth" as const,
              candidates: refusedByAuth.map((skip) => ({ role: skip.role, thread: skip.thread })),
              recorded: { role: authHead.role, thread: authHead.thread },
            },
          }),
      skipped,
    };
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
  const remaining = Math.max(
    0,
    maxConsecutive - consecutiveLaunchesWithoutDelivery(input.events, input.deliveredSessions),
  );
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
    case "parked": {
      // The two parks read differently on purpose (thread 023): one is waiting for a person
      // to decide and lifts with their answer, the other is waiting for a merge and lifts on
      // the notifier's message. A line that called a merge "a decision of pr:127" would send
      // the reader looking for a participant by that name.
      const on = parkedOnKind(skip.parkedOn ?? "");
      if (on.kind === "event")
        return `candidate ${pair} skipped: the turn is parked behind the merge of PR #${on.pr} (R27, 'parked-on: ${skip.parkedOn}' in the feed) — it is waiting for an EVENT, not for a launch; it lifts by itself with the merge of that PR announced anywhere in the mail, and with the next message that MOVES anybody (asks for something, or names whose turn it is — an actionable CI outcome does)`;
      // The third park (thread 019) says what neither of the other two can: the decision is
      // NOT made and no human is making it — a round is running on the PR, and until its
      // verdict lands there is no action to raise anybody for. Which is why its lift is the
      // narrow one: the circuit's own TRACE about that round does not count as an answer. An
      // actionable outcome is not a trace — it hands the turn over, and 023 paid 3.5 hours of
      // a dead pair for reading it as one.
      if (on.kind === "run")
        return `candidate ${pair} skipped: the turn is parked behind the round running on PR #${on.pr} (R27, 'parked-on: ${skip.parkedOn}' in the feed) — it is waiting for a VERDICT, not for a launch; it lifts by itself with the next message that MOVES anybody (asks for something, or names whose turn it is — an actionable CI outcome does, the trace of the round already running does not), and with the merge of that PR`;
      return `candidate ${pair} skipped: the turn is parked behind a decision of ${skip.parkedOn ?? "a person"} (R27, 'parked-on' in the feed) — it is waiting for a PERSON, not for a launch; it lifts by itself with the next substantive message in the thread`;
    }
    case "quota":
      return `candidate ${pair} skipped: the rate-limit window is closed — the window belongs to the ACCOUNT, so a signal from any role stands the whole box down; it ends by the clock and needs nothing from anybody (see 'orchestrator status' for which window and until when)`;
    case "auth":
      return `candidate ${pair} skipped: this box cannot authenticate to the vendor — the credentials belong to the BOX, so a refusal seen by any role stands every role down; unlike the window it does NOT end by the clock (a human runs 'claude login' here), and the shelf only decides how often one pair is raised to knock (see 'orchestrator status')`;
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
