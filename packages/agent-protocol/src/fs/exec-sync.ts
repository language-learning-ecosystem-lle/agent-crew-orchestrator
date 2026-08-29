/**
 * A SYNCHRONOUS CHILD PROCESS WHOSE VERDICT IS THE CHILD'S EXIT CODE, NOT THE
 * PARENT'S ERRNO.
 *
 * `execFileSync` throws on `result.error` OR on a non-zero status. That is one
 * condition too many: `result.error` is documented as "the child could not be
 * spawned", and node signals that case by leaving `status` at `null`. When `status`
 * is a number the child DID run, and its exit code is the answer.
 *
 * WHY THIS IS NOT A THEORETICAL DISTINCTION — measured 2026-08-28 under the codex
 * sandbox (`codex exec --sandbox read-only`, codex-cli 0.150.1, node 24.18.0), the
 * same box, same command, run from node:
 *
 *     spawnSync("git", ["-C", mail, "rev-parse", "--show-toplevel"])
 *       → { error: Error("spawnSync git EPERM"), status: 0,
 *           stdout: "/home/…/.worktrees/comms" }
 *     spawnSync("/bin/echo", ["hi"])
 *       → { error: Error("spawnSync /bin/echo EPERM"), status: 0, stdout: "hi" }
 *
 * The child ran, exited 0 and its output was captured — and `error` was set anyway.
 * The async form (`child_process.spawn`) reported no error at all on the same call.
 * So under that sandbox `execFileSync` turns a SUCCESSFUL git call into a throw, and
 * the mail read path died with `'…/agent-comms' is not inside a git repository:
 * spawnSync git EPERM` — a topology claim on top of a call that had already
 * answered. WHAT IS MEASURED IS THE CONTRADICTORY PAIR (`error` set, `status` 0);
 * WHICH SYSCALL THE SANDBOX REFUSES IS NOT MEASURED AND IS NOT CLAIMED HERE.
 *
 * On an unconfined box this changes nothing: node sets `error` only when the spawn
 * itself failed, and then `status` is `null` — which this helper still treats as a
 * failure, with git's own words (`spawnSync git ENOENT`).
 *
 * Not the whole package: only the calls that READ. The write path (delivery, locks,
 * the runner) keeps `execFileSync` — it is out of the tick that measured this, and a
 * blanket swap would be a change nobody measured.
 */
import { type SpawnSyncOptions, spawnSync } from "node:child_process";

/** What `spawnSync` returned, narrowed to what the verdict is made of. */
export type SyncOutcome = {
  readonly error?: Error | undefined;
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string | null;
  readonly stderr: string | null;
};

/**
 * The verdict itself, as a pure function so it can be tested without a sandbox —
 * the sandbox exists on one box and on no CI runner (see the module doc).
 *
 * `ok: false` carries the reason in the two shapes a caller needs to tell apart:
 * `ran: false` — the child never started (this is what `error` legitimately means);
 * `ran: true` — it started and failed, and then git's own stderr is the reason.
 */
export type SyncVerdict =
  | { readonly ok: true; readonly stdout: string }
  | {
      readonly ok: false;
      readonly ran: boolean;
      readonly status: number | null;
      readonly reason: string;
    };

export const verdictOf = (outcome: SyncOutcome): SyncVerdict => {
  // The child ran: its exit code is the answer, whatever the parent's errno says.
  if (outcome.status === 0 && outcome.signal === null) {
    return { ok: true, stdout: outcome.stdout ?? "" };
  }
  if (outcome.status === null && outcome.signal === null) {
    return {
      ok: false,
      ran: false,
      status: null,
      reason: outcome.error?.message ?? "the child process did not start",
    };
  }
  const said = (outcome.stderr ?? "").trim();
  return {
    ok: false,
    ran: true,
    status: outcome.status,
    reason:
      outcome.signal !== null
        ? `killed by ${outcome.signal}`
        : `exited with code ${outcome.status}${said === "" ? "" : `: ${said}`}`,
  };
};

/** A failure of a call made through {@link execFileSyncByExit}, with the two shapes apart. */
export class SyncRunError extends Error {
  /** Whether the child process started at all — `false` means the spawn itself failed. */
  readonly ran: boolean;
  /** The child's exit code, `null` when it never ran or was killed by a signal. */
  readonly status: number | null;

  constructor(input: {
    readonly message: string;
    readonly ran: boolean;
    readonly status: number | null;
  }) {
    super(input.message);
    this.name = "SyncRunError";
    this.ran = input.ran;
    this.status = input.status;
  }
}

/**
 * Run `file` with `args` and return its stdout, throwing {@link SyncRunError} when the
 * child failed. Drop-in for `execFileSync(file, args, {encoding: "utf8", …})`.
 */
export const execFileSyncByExit = (
  file: string,
  args: readonly string[],
  options: SpawnSyncOptions = {},
): string => {
  const outcome = spawnSync(file, [...args], { ...options, encoding: "utf8" });
  const verdict = verdictOf(outcome as SyncOutcome);
  if (verdict.ok) return verdict.stdout;
  throw new SyncRunError({
    message: `${file} ${args.join(" ")} ${verdict.reason}`,
    ran: verdict.ran,
    status: verdict.status,
  });
};
