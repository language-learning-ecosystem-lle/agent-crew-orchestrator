/**
 * The run observer — the pure core of step S2 (thread 012). The key point: the
 * orchestrator does NOT stop the agent. The agent finishes BY ITSELF, having
 * written its reply and passed the turn; the observer only recognises the outcome
 * and moves the lease running → draining → stopped WITH A TRACE. The agent does
 * not know about its own stop and must not (curator's requirement 3) — hence there
 * is not and cannot be a "tell the agent" here.
 *
 * The completion signal is THE TURN PASSING on the thread the lease was taken for
 * (requirement 1): not "exit code 0" (the process may have exited without writing
 * a reply) and not "the mailbox is empty" (it could have been emptied by someone
 * else's edit). `handedOff` is computed outside from `threadsWaitingOn` over the
 * SOURCE threads and arrives here as a boolean.
 *
 * `handedOff` is checked BEFORE `overdue`: the turn passing is a success, and
 * noticing it at the deadline or slightly later does not mean declaring a timeout.
 * `overdue` only strikes where the turn did NOT pass — then the lease deadline is
 * the limit of `draining` (requirement 2): "it will stop on completion" does not
 * turn into "it will never stop".
 */
import type { OrchestratorEvent } from "./journal.js";

export type Lifecycle = "running" | "draining";

export type ObserveSignals = {
  /** The thread no longer awaits the role — the turn has passed (from threadsWaitingOn). */
  readonly handedOff: boolean;
  /** The session process has finished (by itself or killed). */
  readonly processExited: boolean;
  /** now > the lease deadline. */
  readonly overdue: boolean;
  /**
   * No traces of activity for longer than the idle ceiling (`activity.ts`). The
   * signal arrives ready-made, exactly like `handedOff`: the sampling of traces is
   * IO and lives in the CLI, the decision is here.
   */
  readonly idle?: boolean;
};

/** What to record at the next step (or null — keep observing). */
export type ObserveStep =
  | { readonly record: "handoff-detected" }
  | {
      readonly record: "lease-released";
      readonly reason: "completed" | "timeout" | "stalled" | "exited-without-handoff";
    }
  | null;

/**
 * Whether the turn has passed — by THE STATE OF THE MAIL. A separate function
 * rather than an expression in the shell for exactly one reason: this is the most
 * dangerous branch of broken-thread isolation, and it needs a test of its own
 * (reviewer-pr's remark on PR #5).
 *
 * The thread under the lease WAS awaiting the role; it stopped awaiting — the turn
 * was passed. But "stopped awaiting" and "could not be read" are different things,
 * and by the list of awaiting threads they look the same: an unreadable thread is
 * not in the list. Treating that as the turn passing would mean closing the run as
 * `completed` even though the role did not answer a single line — that is, a
 * broken mail file would quietly forge the acceptance result. Hence unreadability
 * of OUR OWN thread is uncertainty: we keep observing, and the deadline sets the
 * limit.
 */
export const handoffDetected = (input: {
  /** The thread the lease was taken for did not parse during this walk. */
  readonly threadUnreadable: boolean;
  /** Threads awaiting the role NOW (from `threadsWaitingOn` over the readable ones). */
  readonly waitingThreads: readonly string[];
  /** The thread the lease was taken for. */
  readonly thread: string;
}): boolean => !input.threadUnreadable && !input.waitingThreads.includes(input.thread);

export const observeStep = (lifecycle: Lifecycle, signals: ObserveSignals): ObserveStep => {
  if (lifecycle === "running") {
    // The turn has passed — move to draining, do NOT touch the process: it will
    // finish by itself (requirement 3).
    if (signals.handedOff) return { record: "handoff-detected" };
    // NO TRACES for longer than the idle ceiling — the session is stuck (R6). It is
    // checked BEFORE the deadline, and that order is the whole point: a stalled
    // session normally goes quiet long before its wall clock runs out, and if both
    // fire at once `stalled` is the truer of the two diagnoses. The wall clock is
    // left for the opposite failure — a session that produces traces forever.
    if (signals.idle === true) return { record: "lease-released", reason: "stalled" };
    // The deadline without the turn passing — the session was alive and did not fit
    // in the window: the limit of draining/running (requirement 2).
    if (signals.overdue) return { record: "lease-released", reason: "timeout" };
    // The process exited BY ITSELF, without passing the turn, before the deadline —
    // it left without doing the job. The reason is ITS OWN, not `forced`: a force is
    // an external human decision with a `by` trace, whereas here nobody decided
    // anything, the session simply ended. One name for both cases made the journal
    // an instrument that lies in acceptance scenario 3 (curator's statement of
    // work, 20:55).
    if (signals.processExited) {
      return { record: "lease-released", reason: "exited-without-handoff" };
    }
    return null;
  }

  // draining: the turn has already passed (the success is settled). We close on the
  // process exit; if the process hangs past the deadline it is still completed (the
  // job is done), and the CLI kills it.
  if (signals.processExited) return { record: "lease-released", reason: "completed" };
  if (signals.overdue) return { record: "lease-released", reason: "completed" };
  return null;
};

/**
 * A journal event out of an observer step — the CLI fills in ts/role/thread, and
 * on a lease release also the `detail`: the session's exit code and the path to
 * its saved output. Without them "could not write" and "simply exited" are the
 * same record.
 */
export const stepEvent = (
  step: Exclude<ObserveStep, null>,
  base: { readonly ts: string; readonly role: string; readonly thread: string },
  detail?: {
    readonly exitCode?: number | null;
    readonly output?: string;
    /** The id of the session that ran and how much it burned (R18) — what a resume needs. */
    readonly session?: string | undefined;
    readonly steps?: number;
  },
): OrchestratorEvent =>
  step.record === "handoff-detected"
    ? { kind: "handoff-detected", ...base }
    : {
        kind: "lease-released",
        ...base,
        reason: step.reason,
        ...(detail?.exitCode === undefined || detail.exitCode === null
          ? {}
          : { exitCode: detail.exitCode }),
        ...(detail?.output === undefined ? {} : { output: detail.output }),
        ...(detail?.session === undefined ? {} : { session: detail.session }),
        ...(detail?.steps === undefined ? {} : { steps: detail.steps }),
      };
