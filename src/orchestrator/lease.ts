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
 *    taken) and `exhausted` (attempt ≥ MAX_ATTEMPTS after an unsuccessful finish).
 *    The S3 launch condition reads `launchable`, and endless relaunching is gone
 *    by construction.
 */
import { MAX_ATTEMPTS, type OrchestratorEvent, type ReleaseReason } from "./journal.js";

/** The lease lifecycle. `released`/`stopped` are terminal (with `reason`/`mode`). */
export type LeaseLifecycle = "running" | "draining" | "released" | "stopped";

export type LeaseView = {
  readonly role: string;
  readonly thread: string;
  readonly state: LeaseLifecycle;
  /** How many times a lease was taken on this pair — the attempt-ceiling counter. */
  readonly attempt: number;
  /** Wall-clock limit of the current/last run; null if there has been no lease yet. */
  readonly deadline: string | null;
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

/** The lease is active (held by the orchestrator right now). */
const isActive = (state: LeaseLifecycle): boolean => state === "running" || state === "draining";

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

type Acc = {
  role: string;
  thread: string;
  state: LeaseLifecycle;
  attempt: number;
  deadline: string | null;
  reason: LeaseView["reason"];
  lastEvent: OrchestratorEvent["kind"];
};

/**
 * Folding the journal into the lease state of each (role, thread) pair. Events go
 * in line order — a single writer, order by construction.
 */
export const foldLeases = (events: readonly OrchestratorEvent[], now: Date): LeaseView[] => {
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
        reason: null,
        lastEvent: event.kind,
      };
      acc.set(k, cur);
      order.push(k);
    }
    cur.lastEvent = event.kind;

    switch (event.kind) {
      case "lease-acquired":
        cur.state = "running";
        cur.attempt += 1;
        cur.deadline = event.deadline;
        cur.reason = null;
        break;
      case "launch":
        // The process is up; the lease state stays running.
        break;
      case "handoff-detected":
        // The turn left the role — the session is winding down.
        if (isActive(cur.state)) cur.state = "draining";
        break;
      case "lease-released":
        cur.state = "released";
        cur.reason = event.reason;
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
    const overdue = isActive(cur.state) && cur.deadline !== null && nowIso > cur.deadline;
    const failed = isFailedTerminal(cur.state, cur.reason);
    const exhausted = cur.reason === "exhausted" || (failed && cur.attempt >= MAX_ATTEMPTS);
    const launchable = failed && !exhausted;
    return {
      role: cur.role,
      thread: cur.thread,
      state: cur.state,
      attempt: cur.attempt,
      deadline: cur.deadline,
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
  foldLeases(events, now).filter((view) => view.state === "running" || view.state === "draining");
