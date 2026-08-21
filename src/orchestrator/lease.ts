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
import { type DeliveryMarks, NO_DELIVERY_MARKS, pairKey } from "../thread/index-doc.js";
import { MAX_ATTEMPTS, type OrchestratorEvent, type ReleaseReason } from "./journal.js";
import { sessionLogPath } from "./paths.js";
import { type FailureClass, thawAt } from "./thaw.js";

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
  /**
   * The attempt ceiling is exhausted — we do not launch any more. AN EXTERNAL FREEZE
   * WHOSE TIMER HAS RUN OUT IS NOT ONE (thread 013): the pair thawed, so it is exhausted
   * no longer, and every reader that skipped it — the tick, the frame, the courier —
   * stops skipping it in the same breath.
   */
  readonly exhausted: boolean;
  /** The pair CAN be launched again (unsuccessful finish and the ceiling not reached). */
  readonly launchable: boolean;
  /**
   * WHAT SPENT THE CEILING (thread 013), on a pair that reached it — `external` when the
   * last failed run died on the vendor's side before reaching the work, `substantive` when
   * the session worked and left without passing the turn. Absent on every pair that is not
   * at the ceiling: it is a property of the freeze, not of the pair.
   */
  readonly exhaustedClass?: FailureClass;
  /**
   * WHEN THE FREEZE LIFTS BY ITSELF — present only beside `exhaustedClass`, and `null`
   * there is a fact rather than a gap: a `substantive` freeze has no self-thaw by design,
   * and an `external` one with `null` has spent its backoff and stands until a delivery.
   * Kept on the view even after the thaw has passed (`exhausted` is then false), because
   * that is what lets a reader say WHY the pair is back rather than merely that it is.
   */
  readonly thawAt?: string | null;
  /**
   * THE IDENTITY OF THE SERIES OF FREEZES (thread 013) — the stamp of the release that
   * first took this pair to the ceiling since its last delivery. Present on every view of
   * a pair whose counter has reached the ceiling at least once and has not been reset
   * since — INCLUDING while it is thawed, running or draining, which is exactly what
   * distinguishes it from `exhaustedClass`: that one is the state of the freeze right
   * now, this one is the run of attempts the freeze belongs to.
   *
   * It exists because the courier owes a frozen pair ONE call per series (curator, thread
   * 013): an external freeze leaves the exhausted set at every thaw, so a key made of the
   * freeze itself is forgotten in the gap and rings again on the way back. Keyed by this,
   * the second and third rounds are silent and a NEW series — one on the far side of a
   * delivery — rings as it should.
   */
  readonly exhaustedSince?: string;
  /**
   * WHERE THIS PAIR'S TRANSCRIPT LIES (T-1, thread 019) — the `.log` of its LAST run,
   * present only when the caller said where the sessions directory is and the journal
   * has an acquire to derive the name from.
   *
   * It is derived HERE, by `sessionLogPath`, and not looked up in `sessions/` by a
   * reader: the name is composed from the pair and the moment of the acquire, and the
   * supervisor writes by that very function from that very moment (`planLaunch` stamps
   * the `lease-acquired` with the same `now` the path is built from). A second way of
   * answering "which file belongs to this pair" — a directory scan with a prefix match
   * — would be a second source of truth for a question that already has one, and it
   * would silently pick the wrong run the first time two acquires shared a second.
   *
   * The `.supervisor` beside it is `sessionSupervisorPath` of this — one path in the
   * model, the rest of the quadruple derived from it by name.
   */
  readonly sessionLog?: string;
};

// The (role, thread) key goes through JSON so that no separator has to be
// invented: role/thread are kept separately in the accumulator and are never
// parsed back out of the key. Shared with the mail side (`pairKey`), which builds
// its map of the second delivery sign on the very same identity.
const key = pairKey;

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
  marks: DeliveryMarks,
  /**
   * WHEN THIS RUN'S LEASE BEGAN — the left edge of the window the second sign is narrow
   * to (thread 021). `null` (a caller that does not track the acquire) leaves the second
   * sign OFF rather than open-ended: a window without a left edge would count a message
   * this role wrote into this thread at any time in the past, which is the ceiling gone.
   */
  acquiredAt: string | null = null,
): boolean => {
  if (event.kind !== "lease-released" || event.reason !== "exited-without-handoff") return false;
  // The first sign: the id in the header and the id in the event are the same run.
  if (event.session !== undefined && marks.sessions.has(event.session)) return true;
  // The second sign (`deliveryMarks`), for the release whose run never got its id into a
  // header: a message of this role, in this thread, written by a run's worker between the
  // acquire and this very release.
  if (acquiredAt === null) return false;
  const from = Date.parse(acquiredAt);
  const to = Date.parse(event.ts);
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  const stamps = marks.runMessages.get(pairKey(event.role, event.thread)) ?? [];
  return stamps.some((at) => at >= from && at <= to);
};

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
 *
 * `auth-failed` IS NOT A FAILURE EITHER, by the same reasoning applied to the box's
 * credentials (thread 023, the OAuth episode of 2026-08-01) — and this one is not an
 * argument but a measurement: during the outage three pairs (019, 046, 016) went
 * `exhausted` on runs that died in 0 seconds having spent $0, on a first turn that never
 * reached the work. The cause was the token of the box, shared by every role of it, and
 * the ceiling exists to catch a pair breaking on its OWN cause. What stops the retry loop
 * instead is the shelf in `auth.ts`.
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
  /** The stamp of the LAST acquire — the moment the session's file names (T-1). */
  acquiredAt: string | null;
  /**
   * The last release said the run died on the VENDOR's side before reaching the work
   * (thread 013) — the `external` flag the supervisor writes. It is the class of THAT
   * release and of no other, so it is overwritten by every release, including the ones
   * that are not failures: a pair that fails externally and then completes must not carry
   * the flag into its next freeze.
   */
  externalFailure: boolean;
  /** When the last release happened — the clock the external backoff runs from. */
  releasedAt: string | null;
  /**
   * WHEN THIS SERIES OF FREEZES BEGAN (thread 013) — the stamp of the release that took
   * the counter to the ceiling for the first time SINCE THE LAST DELIVERY, and nothing
   * afterwards moves it. It is the identity of the SERIES rather than of one freeze,
   * which is what a courier that must ring once per series needs: an external pair leaves
   * the frozen set at every thaw and comes back to it after the failed retry, so a key
   * built out of "this freeze" is forgotten in between and the call repeats itself.
   * Cleared by exactly the thing that ends the series — a delivery zeroing the counter.
   */
  ceilingSince: string | null;
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
   * What the mail knows about deliveries — the two signs of `isSelfTurnDelivery`.
   * Defaults to neither: a caller that has no mail at hand folds exactly as before, and
   * nothing that only reads the journal has to learn about the circuit.
   */
  marks: DeliveryMarks = NO_DELIVERY_MARKS,
  /**
   * WHERE THE SESSION FILES LIE, when the caller knows (T-1). Omitted — the views carry
   * no `sessionLog` and nothing changes for a caller that only reads the journal; given
   * — every pair with an acquire behind it names its own transcript, derived by the same
   * `sessionLogPath` the supervisor writes by.
   */
  sessions?: string,
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
        acquiredAt: null,
        externalFailure: false,
        releasedAt: null,
        ceilingSince: null,
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
    // `cur.acquiredAt` is THIS run's acquire: the events arrive in order, so at a release
    // it still holds the stamp the matching `lease-acquired` put there. That is the left
    // edge the second sign is narrowed by.
    const selfTurn = isSelfTurnDelivery(event, marks, cur.acquiredAt);
    if (isDelivery(event) || selfTurn) {
      cur.attempt = 0;
      // THE SERIES ENDS WHERE THE COUNTER DOES (thread 013). The two are the same fact —
      // "the pair moved" — so they are reset in the same breath rather than in two places
      // that could come to disagree about when a freeze stops being the same freeze.
      cur.ceilingSince = null;
    }

    switch (event.kind) {
      case "lease-acquired":
        cur.state = "running";
        cur.attempt += 1;
        cur.deadline = event.deadline;
        // The transcript of the run that starts here supersedes the previous one's: the
        // panel showing "the session of this pair" must follow the pair, not stay on the
        // file the last break left behind.
        cur.acquiredAt = event.ts;
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
        // THE ROUND THE VENDOR ENDED IS UNDONE, NOT FORGIVEN LATER (thread 019, §4). The
        // verdict below has never counted `quota-exhausted` as a failure, but the COUNTER
        // was still moved by the `lease-acquired` that opened the round, so a pair that
        // stood at 2/3 came out of a closed window reading 3/3 — and after the next real
        // break the frame printed `attempt 4/3` with no `⚠ EXHAUSTED` beside it, a line
        // that contradicts itself and reads as "one attempt left" when there are two.
        // Measured in `quota-pause.process.test.ts` on the real `status` frame.
        //
        // UNDONE IS THE RIGHT SHAPE, not zeroed: the count belongs to the pair's own break
        // loop and a closed window is not part of it — the two failures before it happened
        // and are still the pair's. This is the same move `consecutiveLaunchesWithoutDelivery`
        // already makes for the run budget ("it is UNDONE, not reset"), now on the ceiling.
        //
        // THE NEIGHBOURING CLASSES ARE LEFT ALONE ON PURPOSE — `auth-failed` and R19's two
        // endings inflate the counter the same way and are the same defect; they belong to
        // their own threads, and a fold quietly changing its number for four reasons at once
        // is not something a reader of one thread can check.
        if (event.reason === "quota-exhausted") cur.attempt = Math.max(0, cur.attempt - 1);
        // The release that DELIVERED into its own turn is remembered as such: the
        // reason stays what the journal says (the process did exit with the turn
        // here), and the judgement below reads this flag instead of the name.
        cur.deliveredToSelf = selfTurn;
        cur.externalFailure = event.external === true;
        cur.releasedAt = event.ts;
        // The release that PUT the pair at the ceiling stamps the series, and only the
        // first one of a series does: rounds 2 and 3 of an external backoff land here with
        // the stamp already set, and leaving it alone is the whole of "one call per series".
        if (
          cur.ceilingSince === null &&
          (event.reason === "exhausted" ||
            (isFailedTerminal("released", event.reason) && !selfTurn && cur.attempt >= maxAttempts))
        ) {
          cur.ceilingSince = event.ts;
        }
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
    const atCeiling = cur.reason === "exhausted" || (failed && cur.attempt >= maxAttempts);
    // THE FREEZE HAS A CLASS AND, FOR ONE OF THE TWO, AN END (thread 013). The class is
    // read off the release rather than judged here: the supervisor saw the stream, this
    // fold sees only the journal. The thaw is a stamp, so the whole policy is one
    // comparison — and the comparison is `>=` for the same reason `overdue` is `>`: the
    // thaw is a moment the pair BECOMES launchable at, not one it must outlive.
    const failureClass: FailureClass | undefined = atCeiling
      ? cur.externalFailure
        ? "external"
        : "substantive"
      : undefined;
    const thaw =
      failureClass === undefined || cur.releasedAt === null
        ? null
        : thawAt({
            failureClass,
            attempt: cur.attempt,
            ceiling: maxAttempts,
            since: cur.releasedAt,
          });
    const thawed = thaw !== null && nowIso >= thaw;
    const exhausted = atCeiling && !thawed;
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
      ...(failureClass === undefined ? {} : { exhaustedClass: failureClass, thawAt: thaw }),
      ...(cur.ceilingSince === null ? {} : { exhaustedSince: cur.ceilingSince }),
      ...(sessions === undefined || cur.acquiredAt === null
        ? {}
        : { sessionLog: sessionLogPath(sessions, cur.role, cur.thread, cur.acquiredAt) }),
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
