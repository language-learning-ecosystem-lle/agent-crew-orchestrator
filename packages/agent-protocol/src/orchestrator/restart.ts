/**
 * `orchestrator restart` — PICKING UP FRESH CODE WITHOUT SITTING AT THE BOX (thread
 * 019, statement of curator by john's request, 2026-07-31 08:11Z).
 *
 * The pain is a fact rather than a guess: every pick-up of a new main was a hand-run
 * pipeline — `down`, then WAITING for the live sessions to end (unpredictably long;
 * once it ended in a force stop), then `git pull --ff-only`, then `pnpm install`, then
 * `up` with the flags of the stopped daemon RECONSTRUCTED FROM MEMORY. Four runs of it
 * in two days, two of them with a stumble (flags not cleared, a trace left
 * uncommitted).
 *
 * This module is the part of that composition which has no processes in it: which argv
 * the new daemon is raised with, and the shape of the wait for the old one to leave.
 * The commands it composes (`down`/`stop --mode force`/`up`) are untouched — a restart
 * is a composition on top, never a second implementation of any of them.
 *
 * WHY THE ARGV COMES FROM STATE AND NOT FROM THE OPERATOR'S MEMORY. "Raise it again the
 * way it was raised" is the whole request; an operator retyping `--max-runs 2 --effort
 * high` from memory is exactly the stumble the command exists to remove, and a flag
 * silently dropped in that retyping produces a circuit that LOOKS restarted and behaves
 * differently. So `up` writes down what it started the daemon with, beside the pid it
 * already writes, and `restart` reads it back. A daemon raised before this file existed
 * (or by hand) leaves nothing to read — then the flags typed on `restart` are used and
 * THE SOURCE IS SAID OUT LOUD, because "the same flags" and "the flags you just typed"
 * are different promises and the operator must never have to guess which one was kept.
 *
 * Changing the settings is deliberately NOT what this command is for: that is `down`
 * plus `up <new flags>`, two words, and it keeps `restart` meaning one thing.
 */

/** How long the wait for the old daemon to leave runs before it gives up (seconds). */
export const DEFAULT_RESTART_WAIT_SEC = 3600;
/** How often the wait asks whether the daemon is still there (seconds). */
export const DEFAULT_RESTART_POLL_SEC = 5;

/**
 * The flags `restart` owns. They describe THE RESTART (how to stop, whether to pull,
 * how long to wait) and mean nothing to the daemon behind it, so they are stripped
 * before the argv is handed on — the same way `up` drops `--pid-file`/`--daemon-log`.
 */
export const RESTART_OWN_VALUE_FLAGS = [
  "--mode",
  "--thread",
  "--reason",
  "--by",
  "--wait",
] as const;
/**
 * `--self` says WHO TYPED IT (055.2): the daemon itself rather than a hand. It changes
 * nothing about what the restart does — only the words in the log, so that the two are
 * distinguishable when read a day later — and it is owned by this command for the same
 * reason `--pull` is: the daemon behind it has never heard of it.
 */
export const RESTART_OWN_BOOLEAN_FLAGS = ["--pull", "--self"] as const;

/** Where `up` writes the argv it raised the daemon with — beside the pid file. */
export const daemonArgvPath = (pidFile: string): string => `${pidFile}.args`;

/** The argv as written by `up`; anything that is not a list of strings is no answer at all. */
export const parseDaemonArgv = (text: string): readonly string[] | undefined => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) return undefined;
  return raw as readonly string[];
};

export const renderDaemonArgv = (argv: readonly string[]): string => `${JSON.stringify(argv)}\n`;

/** `restart`'s own flags removed, values included — what is left is the daemon's. */
export const withoutRestartFlags = (argv: readonly string[]): readonly string[] => {
  const kept: string[] = [];
  for (let at = 0; at < argv.length; at += 1) {
    const token = argv[at] as string;
    if ((RESTART_OWN_VALUE_FLAGS as readonly string[]).includes(token)) {
      at += 1;
      continue;
    }
    if ((RESTART_OWN_BOOLEAN_FLAGS as readonly string[]).includes(token)) continue;
    kept.push(token);
  }
  return kept;
};

export type DaemonArgv = {
  readonly argv: readonly string[];
  /** `state` — the flags of the daemon that was just stopped; `typed` — this command's. */
  readonly source: "state" | "typed";
};

/**
 * WITH WHAT THE NEW DAEMON IS RAISED. The state wins whenever it exists — that is the
 * promise of the command; the typed argv is the fallback and is announced as such.
 */
export const daemonArgvFor = (input: {
  readonly saved: readonly string[] | undefined;
  readonly typed: readonly string[];
}): DaemonArgv =>
  input.saved === undefined || input.saved.length === 0
    ? { argv: withoutRestartFlags(input.typed), source: "typed" }
    : { argv: input.saved, source: "state" };

export type ExitOutcome =
  | { readonly kind: "absent" }
  | { readonly kind: "gone"; readonly waitedSec: number }
  | { readonly kind: "timeout"; readonly waitedSec: number };

/**
 * THE WAIT IS THE COMMAND'S JOB, NOT THE OPERATOR'S (the design fork curator left open:
 * who waits — the process or a successor daemon). The restart process waits itself and
 * prints its phases: a successor would have to be raised BEFORE the predecessor is gone,
 * i.e. two daemons on one journal for as long as the drain lasts — the very state `up`
 * refuses at its door. One process that lives until the new daemon is up is also the
 * only shape in which "type it and walk away" is true: the exit code is the outcome.
 *
 * A TIMEOUT DOES NOT RAISE ANYTHING. The stop flag stays where it is and the circuit
 * stays dark — a daemon raised over a draining one would take the same pair twice, and
 * the operator would find that out from the journal, hours later.
 */
export const awaitDaemonExit = async (input: {
  readonly pid: number | undefined;
  readonly alive: (pid: number) => boolean;
  readonly sleep: (ms: number) => Promise<void>;
  /** Monotonic-enough seconds; injected so the wait is testable without waiting. */
  readonly now: () => number;
  readonly waitSec: number;
  readonly pollSec: number;
  readonly note?: (waitedSec: number) => void;
}): Promise<ExitOutcome> => {
  const { pid } = input;
  if (pid === undefined) return { kind: "absent" };
  const started = input.now();
  let announced = 0;
  for (;;) {
    if (!input.alive(pid)) return { kind: "gone", waitedSec: input.now() - started };
    const waited = input.now() - started;
    if (waited >= input.waitSec) return { kind: "timeout", waitedSec: waited };
    // A wait with no output is indistinguishable from a hang — the class this package
    // keeps paying for ("silent ≠ idle"). Once a minute is enough to see it is alive.
    if (input.note !== undefined && waited - announced >= 60) {
      announced = waited;
      input.note(waited);
    }
    await input.sleep(input.pollSec * 1000);
  }
};
