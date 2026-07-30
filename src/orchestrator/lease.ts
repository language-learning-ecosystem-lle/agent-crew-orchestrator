/**
 * A lease is the orchestrator's current operational state, folded FROM the
 * journal. Step S0 (thread 012). A lease is not stored as a separate mutable
 * file: it is a projection of the append-only journal, `foldLeases(events, now)`.
 * The same technique as `_thread.md`/`INDEX` in the circuit — an append-only
 * source with state folded on top of it, and there is nothing for two writers to
 * drift on. It survives a daemon restart for free: the journal is on disk, the
 * fold is recomputed.
 *
 * Both gaps named by curator (thread 012) are closed here — with FIELDS, not with
 * behaviour (there is no spawn in S0):
 *  - gap 1 "working vs stuck": `overdue` — the lease is alive while its `deadline`
 *    has already passed. Visible in the data BEFORE any action; releasing on
 *    timeout is S2/S4 behaviour, but the sign exists from S0 on.
 *  - gap 2 "broke off, but the mail stayed": `attempt` (how many times a lease was
 *    taken SINCE THE LAST DELIVERY) and `exhausted` (attempt ≥ the ceiling after an
 *    unsuccessful finish). The S3 launch condition reads `launchable`, and endless
 *    relaunching is gone by construction.
 *
 * THE COUNTER IS CONSECUTIVE, NOT CUMULATIVE (curator's defect report, 2026-07-26,
 * requirement 2). It used to count every lease the pair had ever taken, so a
 * long-lived thread reached the ceiling no matter how many of its runs SUCCEEDED:
 * dev-core×016 stood at `attempt 13` with eleven completions behind it and dropped
 * out of the candidates for good — a bomb with a counter rather than a protection.
 * What the ceiling exists to catch is a "launch → break → launch" loop, and that is
 * a run of failures WITHOUT a delivery in between, so a delivery resets the count.
 *
 * A DELIVERY IS `completed` OR `handoff-detected`. The turn passing on the thread is
 * the delivery itself; the `completed` release is the observer writing it down. If a
 * session hands the turn over and the supervisor dies before it can record the
 * release, the outcome is `supervisor-gone` — a failure — while the work did arrive.
 * Counting that as a failed attempt would push a productive pair towards the ceiling
 * for a fault of the supervisor's, so the reset hangs on the handoff as well.
 */
import { MAX_ATTEMPTS, type OrchestratorEvent, type ReleaseReason } from "./journal.js";

/**
 * The lease lifecycle. `released`/`stopped` are terminal (with `reason`/`mode`).
 *
 * `waiting` is the interactive turn (R19): the session has passed the turn, asked for
 * input and is deliberately still alive. It is ALIVE for every purpose that matters —
 * nothing may be launched on the pair, `status` shows it, an unclosed one is an orphan
 * — and it is a state of its own rather than a flag on `running` because the two are
 * judged by different clocks and different failures: a `running` session that goes
 * quiet is stalled, a `waiting` one is doing exactly what it was told to.
 */
export type LeaseLifecycle = "running" | "draining" | "waiting" | "released" | "stopped";

export type LeaseView = {
  readonly role: string;
  readonly thread: string;
  readonly state: LeaseLifecycle;
  /**
   * How many times a lease was taken on this pair SINCE ITS LAST DELIVERY (a
   * `completed` release or a handoff) — the attempt-ceiling counter.
   */
  readonly attempt: number;
  /** The ceiling `attempt` is judged against — printed beside it, never guessed at. */
  readonly ceiling: number;
  /**
   * Wall-clock limit of the current/last run; null if there has been no lease yet.
   * SHIFTED by the time the run spent parked (R19): the window belongs to the work,
   * and a wait for a human is not work the session was doing.
   */
  readonly deadline: string | null;
  /** While `waiting` — the limit of THE WAIT (R19); null in every other state. */
  readonly waitDeadline: string | null;
  /** Reason for the terminal state (release/stop), otherwise null. */
  readonly reason: ReleaseReason | "graceful" | "forced" | null;
  /** Kind of the pair's last event — for the "last" column in status. */
  readonly lastEvent: OrchestratorEvent["kind"];
  /** The lease is alive, but its `deadline` has already passed relative to `now`. */
  readonly overdue: boolean;
  /** The attempt ceiling is exhausted — we do not launch any more. */
  readonly exhausted: boolean;
  /** The pair CAN be launched again (unsuccessful finish and the ceiling not reached). */
  readonly launchable: boolean;
};

// The (role, thread) key goes through JSON so that no separator has to be
// invented: role/thread are kept separately in the accumulator and are never
// parsed back out of the key.
const key = (role: string, thread: string): string => JSON.stringify([role, thread]);

/**
 * The lease is active (held by the orchestrator right now) — EXPORTED because it is
 * the guard two launch paths depend on (`planLaunch`, `planTick`), and the third state
 * of R19 is exactly the kind of addition that used to be missed in one of them: a
 * parked pair becomes a launch candidate the moment its answer lands, and at that
 * moment its session is alive and about to resume. Two inline comparisons would have
 * been two places to remember, one of which raises a second session on top of a live
 * one.
 */
export const isLeaseAlive = (state: LeaseLifecycle): boolean =>
  state === "running" || state === "draining" || state === "waiting";

const isActive = isLeaseAlive;

/**
 * THE DELIVERY, in one place — because two different ceilings reset on it (the
 * per-pair `attempt` folded here and the global run budget in `launch.ts`), and until
 * 2026-07-26 they each carried their own idea of what a delivery is: this one counted
 * the handoff, that one did not. Two definitions of the same word is how a rule drifts
 * apart from itself, and the drift was not theoretical — the global counter walked
 * towards its ceiling on a run of "the turn was passed, then the supervisor died",
 * i.e. for runs that had all delivered.
 *
 * `handoff-detected` counts because the turn passing IS the delivery — the `completed`
 * release is only the observer writing it down, and an observer that dies in between
 * loses the record, not the work.
 */
export const isDelivery = (event: OrchestratorEvent): boolean =>
  event.kind === "handoff-detected" ||
  (event.kind === "lease-released" && event.reason === "completed");

/**
 * THE THIRD SHAPE OF A DELIVERY: THE TURN THAT STAYED ON THE ROLE (thread 023, the
 * night's analysis by curator; john's decision of 2026-07-30 puts it in the same class
 * as finding C — a break whose cause is not the pair's own).
 *
 * `handoffDetected` asks one question — "does the thread still await the role?" — and
 * for a message that PASSES the turn on that is the whole truth. But scalar
 * `waiting-on` (v13) made `waiting-on: <the writer itself>` the ONLY legal shape for
 * "this needs a human decision": `john` is not accepted in the field at all, so the
 * one who carries the question keeps the turn. Such a run writes its message, checks
 * it in `origin/comms` and exits — and the observer, seeing the thread still awaiting
 * the role, records `exited-without-handoff`, the name that counts towards the attempt
 * ceiling. Reproduced as a controlled comparison on ONE thread within nine minutes:
 * two curator runs of the same class, `waiting-on: curator` → a failed attempt,
 * `waiting-on: dev-core` → a delivery. The only difference was that field.
 *
 * The cost was not the quota: four pairs (curator×016/024/033/034) went `exhausted`
 * for delivering by the norm, and an `exhausted` pair does not come back on its own —
 * the reset hangs on a delivery, and an answer that leaves the turn where it is is not
 * one. The more carefully the role followed the rule, the faster its thread died.
 *
 * THE DIFFERENTIATOR IS THE MAIL, NOT A NEW EVENT — and that is deliberate, because it
 * is what makes the fix retroactive. The journal keeps its honest record ("the process
 * exited with the turn still here"); the READING adds the fact the journal never had:
 * a message of this very session is in the mail. Both halves of the judgement are
 * needed and neither alone is enough — a session that died silently wrote nothing, and
 * a message signed by ANOTHER session says nothing about this run. So the historical
 * pairs are reclassified the moment the fold is given the mail, with nobody's hand
 * fixing anything up.
 *
 * The set is of SESSIONS, not of roles or threads: a role writes into its thread from
 * many runs over a day, and only the one that wrote during this lease delivered.
 * `lease-released` carries `session`; `handoff-detected` does not (it does not need to
 * — the turn passing is visible in the mail by itself), which is why this predicate is
 * written against the release event alone.
 */
export const isSelfTurnDelivery = (
  event: OrchestratorEvent,
  deliveredSessions: ReadonlySet<string>,
): boolean =>
  event.kind === "lease-released" &&
  event.reason === "exited-without-handoff" &&
  event.session !== undefined &&
  deliveredSessions.has(event.session);

/**
 * A terminal FAILURE: the run was broken off rather than finished normally. Three
 * reasons — timeout, force and exiting on its own without passing the turn (the
 * last one separated from force, see `RELEASE_REASONS`); for the attempt ceiling
 * they are equal: in all of them the turn did not pass, and the pair may only be
 * retried up to `MAX_ATTEMPTS`.
 */
const isFailedTerminal = (state: LeaseLifecycle, reason: LeaseView["reason"]): boolean =>
  !isActive(state) &&
  (reason === "timeout" ||
    reason === "forced" ||
    reason === "exited-without-handoff" ||
    reason === "supervisor-gone");

/**
 * THE TWO ENDINGS OF AN INTERACTIVE TURN ARE NOT FAILURES (R19), and that is a
 * decision rather than an omission from the list above. `input-timeout` and
 * `exited-while-waiting` both leave the mail CONSISTENT: the question is in the
 * thread, the turn is with somebody else, nobody is blocked waiting for a role that
 * will never answer. That is the opposite of the gap the attempt ceiling was built
 * for ("it broke off, but the mail stayed"), so counting them would exhaust a pair
 * for the one thing that is supposed to happen — a human taking their time. When the
 * answer does land, the role is awaited again and the pair is raised as usual.
 *
 * `quota-exhausted` IS NOT A FAILURE EITHER, and this is the load-bearing half of
 * finding C (thread 023). The mail here is NOT consistent — the turn did not pass, the
 * thread still waits — so the pair must be retried, and it will be. What must not
 * happen is the retry counting: the window is one shared resource of the whole box,
 * so the same closure hits every role at once, and three closures would mark every
 * pair `exhausted` within one afternoon. The ceiling exists to catch a pair that
 * breaks on its OWN cause ("launch → break → launch"); a closed window is not that
 * pair's cause and not any pair's cause. Excluding it keeps `attempt` meaning what it
 * says. WHAT STOPS THE RETRY LOOP INSTEAD is the backoff on the reopening time — it
 * is NOT in this part of D-3, and until it lands the tick will keep re-raising a role
 * into a closed window, cheaply (the session dies at once) but loudly.
 */

type Acc = {
  role: string;
  thread: string;
  state: LeaseLifecycle;
  attempt: number;
  deadline: string | null;
  /** The limit of the current wait (R19), while there is one. */
  waitDeadline: string | null;
  /** When the current wait began — the other end of the shift of the work deadline. */
  waitingSince: string | null;
  reason: LeaseView["reason"];
  /** The last release delivered into its own turn (`isSelfTurnDelivery`). */
  deliveredToSelf: boolean;
  lastEvent: OrchestratorEvent["kind"];
};

/** ISO stamp + milliseconds → ISO stamp, in the journal's own second-precision shape. */
const shifted = (stamp: string, byMs: number): string =>
  `${new Date(new Date(stamp).getTime() + byMs).toISOString().slice(0, 19)}Z`;

/**
 * Folding the journal into the lease state of each (role, thread) pair. Events go
 * in line order — a single writer, order by construction.
 *
 * `maxAttempts` is a PARAMETER rather than the constant read on the spot: since the
 * defect of 2026-07-26 the ceiling is an operator's flag (`--max-attempts`), and a
 * fold that reached for the constant behind the caller's back would make the flag
 * unreachable exactly the way `--max-runs` was.
 */
export const foldLeases = (
  events: readonly OrchestratorEvent[],
  now: Date,
  maxAttempts: number = MAX_ATTEMPTS,
  /**
   * Sessions that wrote a message into the mail (`isSelfTurnDelivery`). Defaults to
   * empty — a caller that has no mail at hand folds exactly as before, and nothing
   * that only reads the journal has to learn about the circuit.
   */
  deliveredSessions: ReadonlySet<string> = new Set(),
): LeaseView[] => {
  const acc = new Map<string, Acc>();
  const order: string[] = [];

  for (const event of events) {
    // A refused launch creates no lease — it is not a session state but a trace of
    // the orchestrator's decision. It does not enter the lease fold.
    if (event.kind === "launch-refused") continue;
    const k = key(event.role, event.thread);
    let cur = acc.get(k);
    if (cur === undefined) {
      cur = {
        role: event.role,
        thread: event.thread,
        state: "released",
        attempt: 0,
        deadline: null,
        waitDeadline: null,
        waitingSince: null,
        reason: null,
        deliveredToSelf: false,
        lastEvent: event.kind,
      };
      acc.set(k, cur);
      order.push(k);
    }
    cur.lastEvent = event.kind;
    // The counter goes back to zero on a DELIVERY, whichever of its two shapes this
    // event is (`isDelivery`) — one predicate rather than a reset written into each
    // branch, so the per-pair ceiling and the global one cannot come to mean different
    // things again.
    const selfTurn = isSelfTurnDelivery(event, deliveredSessions);
    if (isDelivery(event) || selfTurn) cur.attempt = 0;

    switch (event.kind) {
      case "lease-acquired":
        cur.state = "running";
        cur.attempt += 1;
        cur.deadline = event.deadline;
        cur.waitDeadline = null;
        cur.waitingSince = null;
        cur.reason = null;
        break;
      case "launch":
        // The process is up; the lease state stays running.
        break;
      case "handoff-detected":
        // The turn left the role — the session is winding down. (The attempt count was
        // already zeroed above: this event is a delivery.)
        if (isActive(cur.state)) cur.state = "draining";
        break;
      case "input-awaited":
        // The run is parked (R19). The work deadline is left where it is and stops
        // being the clock in force: `overdue` below reads the wait's own limit while
        // the state is `waiting`.
        cur.state = "waiting";
        cur.waitDeadline = event.deadline;
        cur.waitingSince = event.ts;
        break;
      case "input-received":
        // Back to work, and the work deadline moves by exactly the time the wait took
        // — the window was given to the work, and a wait for a human is not it.
        if (cur.waitingSince !== null && cur.deadline !== null) {
          cur.deadline = shifted(
            cur.deadline,
            new Date(event.ts).getTime() - new Date(cur.waitingSince).getTime(),
          );
        }
        cur.state = "running";
        cur.waitDeadline = null;
        cur.waitingSince = null;
        break;
      case "lease-released":
        cur.state = "released";
        cur.reason = event.reason;
        // The release that DELIVERED into its own turn is remembered as such: the
        // reason stays what the journal says (the process did exit with the turn
        // here), and the judgement below reads this flag instead of the name.
        cur.deliveredToSelf = selfTurn;
        cur.waitDeadline = null;
        cur.waitingSince = null;
        break;
      case "stop":
        cur.state = "stopped";
        cur.reason = event.mode;
        break;
    }
  }

  const nowIso = `${now.toISOString().slice(0, 19)}Z`;
  return order.map((k) => {
    const cur = acc.get(k) as Acc;
    // WHICH CLOCK IS IN FORCE depends on the state: a parked lease is late when nobody
    // answered in time, not when the work window ran out — the work window is frozen
    // while it waits, and judging it by that one would report every long wait as a
    // session that overran.
    const clock = cur.state === "waiting" ? cur.waitDeadline : cur.deadline;
    const overdue = isActive(cur.state) && clock !== null && nowIso > clock;
    // A run that delivered into its own turn is NOT a failed attempt, whatever the
    // release is named: the mail it left is consistent (the question is in the thread,
    // self-sufficient), and it broke on nobody's cause — the same reasoning by which
    // R19's two endings and `quota-exhausted` were taken off this list, now a third
    // case of it rather than a new policy (john, 2026-07-30).
    const failed = isFailedTerminal(cur.state, cur.reason) && !cur.deliveredToSelf;
    const exhausted = cur.reason === "exhausted" || (failed && cur.attempt >= maxAttempts);
    const launchable = failed && !exhausted;
    return {
      role: cur.role,
      thread: cur.thread,
      state: cur.state,
      attempt: cur.attempt,
      ceiling: maxAttempts,
      deadline: cur.deadline,
      waitDeadline: cur.waitDeadline,
      reason: cur.reason,
      lastEvent: cur.lastEvent,
      overdue,
      exhausted,
      launchable,
    };
  });
};

/**
 * Pairs whose lease is still ALIVE. Needed at supervisor start-up: a lease nobody
 * can close is indistinguishable from normal work from the outside — that is
 * exactly how, after the acceptance of 2026-07-25, the journal showed `running`
 * for a whole day about something long done. A new supervisor must speak up about
 * such leases instead of silently carrying on.
 */
export const unclosedLeases = (events: readonly OrchestratorEvent[], now: Date): LeaseView[] =>
  foldLeases(events, now).filter((view) => isLeaseAlive(view.state));
