/**
 * WHERE THIS SUITE'S FIXTURES ARE ALLOWED TO LIVE (thread `098-box-red-process-tests`).
 *
 * MEASURED, 2026-09-03, on the box that runs the circuit: `pnpm test` on a clean `main`
 * fails 8 files / 15 tests while the runner is GREEN on the same head. The whole of that
 * redness is one premise that no test states out loud and every one of them relies on:
 *
 *     `os.tmpdir()` is not inside a git repository.
 *
 * On a runner it holds — `TMPDIR` is `/tmp`. On this box it does not, and deliberately so:
 * the orchestrator points a raised session's `TMPDIR` at a directory of its own INSIDE the
 * checkout (`orchestrator/run-tmp.ts`, thread `056`), precisely so that a session writing
 * «somewhere temporary» writes into its own place. The variable is a symlink:
 *
 *     /tmp/aco-<id> -> <checkout>/.orchestrator/sessions/<run>.tmp
 *
 * so every `mkdtempSync(join(tmpdir(), …))` in this package lands INSIDE the checkout of
 * the contour. A fixture that must not be a repository then is one; a fixture that IS a
 * repository gains an enclosing one; and the tests that ask git «what am I standing in»
 * answer about the contour instead of the bench. Hence the eight files: `fs/git`,
 * `read-under-sandbox.process`, `orchestrator/home.process`, `orchestrator/instance-flag
 * .process`, `orchestrator/restart.process`, `orchestrator/run.process`, `orchestrator/
 * systemd-install.process` and `merge/gate.process` — they are not eight defects, they are
 * the eight places that happen to ASK.
 *
 * WHY THE HARNESS AND NOT 135 CALL SITES. The premise belongs to the suite, not to any one
 * of the 84 files that take a temp directory: fixing it per file leaves the next file to be
 * written with the same hidden assumption and the same day of diagnosis behind it. So the
 * base is chosen once, before a test module is loaded (`vitest.config.ts` → `setupFiles`),
 * and every `tmpdir()` — including the ones inside a CLI this suite spawns, which inherits
 * the variable — is answered from it.
 *
 * WHY THIS IS NOT THE SANDBOX'S JOB. `testing/process-sandbox.ts` scrubs the ambient
 * environment of ONE spawned launch, and it says in its own words that `TMPDIR` is
 * deliberately not on its list: that would be a claim about the harness made from inside a
 * single launch. This file is the harness making the claim about itself, which is the only
 * place it can honestly be made.
 *
 * NOTHING IS GUESSED AND NOTHING IS SKIPPED. A `TMPDIR` that is already neutral is left
 * exactly as it is (a runner keeps running what it ran); one that is inside a repository is
 * moved to the platform's shared temp — the very place a runner uses — and if THAT is
 * inside a repository too, the suite refuses by name instead of going quietly red.
 */
import { spawnSync } from "node:child_process";

/**
 * The platform's shared temp: what `os.tmpdir()` answers when nothing in the environment
 * names one. Spelled out rather than derived by unsetting three variables, because the
 * derivation would have to mutate `process.env` to ask the question — and this package
 * runs on Linux with systemd (`orchestrator/systemd.ts`), where the answer is `/tmp`.
 */
export const PLATFORM_SHARED_TMP = "/tmp";

/** Raised when no candidate base is outside a repository — a red with a cause attached. */
export class TmpBaseError extends Error {
  override readonly name = "TmpBaseError";
}

/**
 * The work tree a directory stands in, or `undefined` when it stands in none. Asked of git
 * itself rather than by walking up looking for `.git`, because git's own answer is what the
 * code under test gets — worktree files, `--separate-git-dir` and ceilings included.
 */
export const enclosingRepository = (dir: string): string | undefined => {
  const result = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return undefined;
  const top = (result.stdout ?? "").trim();
  return top.length === 0 ? undefined : top;
};

/** The base this suite will hand to `mkdtemp`, and where it came from. */
export type TmpBaseChoice = {
  readonly base: string;
  /** Set only when the environment's own base had to be left behind — and why. */
  readonly movedFrom?: { readonly base: string; readonly repository: string };
};

/**
 * CHOOSE THE BASE. Pure on purpose — the probe is an argument, so the three outcomes are
 * testable without a box that has any particular `TMPDIR`.
 */
export const neutralTmpBase = (input: {
  /** `os.tmpdir()` as the environment resolves it right now. */
  readonly current: string;
  /** Where to go when the current one is inside a repository. */
  readonly fallback: string;
  readonly probe: (dir: string) => string | undefined;
}): TmpBaseChoice => {
  const enclosing = input.probe(input.current);
  if (enclosing === undefined) return { base: input.current };

  const fallbackEnclosing = input.probe(input.fallback);
  if (fallbackEnclosing !== undefined) {
    throw new TmpBaseError(
      `this suite needs a temp base OUTSIDE a git repository and this box has none: '${input.current}' is inside '${enclosing}', and the fallback '${input.fallback}' is inside '${fallbackEnclosing}'. Fixtures that must not be repositories cannot be created anywhere here — run the suite with TMPDIR pointing at a directory that is not under a checkout`,
    );
  }
  return { base: input.fallback, movedFrom: { base: input.current, repository: enclosing } };
};
