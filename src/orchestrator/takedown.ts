/**
 * PUTTING THE SESSION'S PROCESS GROUP DOWN, AND SAYING SO WHEN IT DID NOT GO DOWN
 * (thread `047-devops-role`).
 *
 * The supervisor raises the session `detached`, so the tool and everything it spawns sit
 * in one process group and one `process.kill(-pid, SIGTERM)` reaches all of them. Three
 * sites do it — the force stop, the terminal lease-released, and `recordSupervisorGone` —
 * and until now all three wrapped the call in `catch {}` under one comment: "the group is
 * already gone — fine".
 *
 * THAT COMMENT NAMES ONE ERRNO AND SWALLOWS EVERY OTHER. `ESRCH` is indeed the benign
 * one: no such group, the session exited on its own between the check and the signal, and
 * there is nothing to say. `EPERM` is its OPPOSITE — the group exists and this process may
 * not signal it — and the package already reads that errno the right way in two other
 * places (`runningDaemon`, `checkout-lock`: EPERM means alive and somebody else's). Here
 * it went into the same silent branch, so the one outcome the caller must never assume —
 * the session is still running while the lease is released — was indistinguishable from
 * the one it may.
 *
 * Nothing on this box produces EPERM today: supervisor and session are the same user. The
 * defect is that the door does not SPEAK, and a door that stays silent about the failure
 * it exists to catch is worse than an absent one — the release goes ahead either way, and
 * the operator gets a journal that says `lease-released` with a live session underneath
 * it. It becomes reachable the moment a role runs as its own system user (`systemUser`,
 * PR #111): the supervisor stays the daemon's user, the group belongs to another, and
 * `kill` refuses with exactly this errno. So the takedown is made audible FIRST, on its
 * own, before anything switches user — the alternative is shipping the switch and the
 * blindness together.
 *
 * The signal is not escalated to SIGKILL here and the release is not held back. Both would
 * be new policy about a case nobody has measured yet; what the caller needs first is to be
 * told, by name, that its takedown did not take.
 */

/** What the three sites send: the tool is given the chance to finish writing. */
export const TAKEDOWN_SIGNAL = "SIGTERM" as const;

/** The errno that means the group is already gone — the one silent outcome. */
export const ALREADY_GONE = "ESRCH";

/**
 * The complaint, as a pure function of the error the `kill` threw. `undefined` is
 * "nothing to say" and covers exactly one case: `ESRCH`.
 *
 * The text names the group, the errno and the consequence, and ends with the command a
 * human would type — the takedown is not retried from here, so the repair has to be
 * legible without opening this file.
 */
export const groupTakedownComplaint = (input: {
  readonly pid: number;
  readonly error: unknown;
}): string | undefined => {
  const code = (input.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === ALREADY_GONE) return undefined;
  const named =
    code === "EPERM"
      ? "the group is ALIVE and this process may not signal it (another system user owns it)"
      : `the group could not be signalled (${code ?? describeError(input.error)})`;
  return [
    `${TAKEDOWN_SIGNAL} to session group -${input.pid} was refused: ${named}.`,
    "The session may still be running while this supervisor lets the lease go —",
    "a second session on the same thread is what that costs.",
    `Repair: put it down by hand as its owner — kill -${TAKEDOWN_SIGNAL.replace("SIG", "")} -${input.pid}.`,
  ].join(" ");
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The takedown itself: signal the whole group, and hand a complaint to `say` when the
 * signal did not land. `kill` is injectable so the classification above can be tested
 * without a live process group; the default is the real syscall.
 *
 * Returns whether the group was signalled — the three call sites ignore it today (they
 * release either way, which is the behaviour this change deliberately does not touch),
 * but the answer is the thing a future policy would branch on, and inventing it later
 * would mean re-reading the errno at each site again.
 */
export const putGroupDown = (input: {
  readonly pid: number;
  readonly say: (text: string) => void;
  readonly kill?: (target: number, signal: NodeJS.Signals) => void;
}): boolean => {
  const kill = input.kill ?? ((target, signal) => void process.kill(target, signal));
  try {
    kill(-input.pid, TAKEDOWN_SIGNAL);
    return true;
  } catch (error) {
    const complaint = groupTakedownComplaint({ pid: input.pid, error });
    if (complaint !== undefined) input.say(complaint);
    return false;
  }
};
