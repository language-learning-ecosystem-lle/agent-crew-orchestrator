/**
 * THE RUN'S OWN «TEMPORARY» HAS TO FIT A SOCKET (thread `070-session-tmpdir-breaks-tests`).
 *
 * `056-shared-tmp-mechanism` gave every run its own `TMPDIR` beside its log, so that an
 * ordinary command (`mktemp -d`, a redirect, a vendor's spool) lands in this run's place BY
 * CONSTRUCTION. The name of that place is the run's name — a timestamp, a role and a thread
 * slug — and on this box it came out 131 characters long. That is fine for a file and fatal
 * for a socket, and a session is a thing that opens sockets.
 *
 * WHAT WAS MEASURED (role's box, 2026-09-02, all numbers reproduced by the commands in the
 * thread):
 *
 *   - a unix socket path of 108 characters binds; 109 fails with `listen EINVAL`. The limit
 *     is `sizeof(struct sockaddr_un.sun_path)` on Linux, and it applies to the STRING passed
 *     to `bind()`, not to what that string resolves to — which is the whole reason the way
 *     out below is a symlink and not a shorter directory;
 *   - `tsx` — the loader every process test in this repository spawns through — opens
 *     `<TMPDIR>/tsx-<uid>/<pid>.pipe`, 22 characters with a four-digit uid and a seven-digit
 *     pid. So `TMPDIR` of 86 characters runs and 87 dies: 86 + 22 = 108;
 *   - the variable is LENGTH, not location: the same 142-character name under `/tmp` fails,
 *     a 71-character name inside the state directory runs.
 *
 * WHY IT MATTERS BEYOND ONE LOADER. Under the long `TMPDIR` all 36 tests of
 * `notify.process.test.ts` failed and every judging role learned to type `TMPDIR=/tmp` by
 * hand. That is the inverse of what `056` bought: the shared `/tmp` was protected by a
 * mechanism, and the role's own acceptance instrument was broken by discipline. A role whose
 * local run is red for reasons of the bench cannot tell its own regression from noise.
 *
 * WHY A SHORT ALIAS AND NOT A SHORTER NAME. No path derived from the checkout can be
 * GUARANTEED short — `/home/…/agent-crew-orchestrator/.orchestrator/sessions/` is already 65
 * characters before the run is named, and the next box may be deeper. Shortening the run's
 * name buys margin and keeps the class; a symlink removes it. The real directory stays
 * beside the log, so `056` is untouched: what the session writes still lands there, the
 * sweep still names the leftovers there, and the only thing in the shared `/tmp` is one
 * symlink named after that directory's own hash, removed when the run ends.
 */
import { createHash } from "node:crypto";
import { readlinkSync, symlinkSync, unlinkSync } from "node:fs";

/**
 * HOW LONG A UNIX SOCKET PATH MAY BE — measured, not remembered. See the header: 108 binds,
 * 109 is `listen EINVAL`.
 */
export const SOCKET_PATH_MAX = 108;

/**
 * WHAT IS RESERVED FOR WHATEVER THE SESSION RUNS. `tsx` needs 22 of it; the reserve is set
 * above that on purpose — the budget belongs to the session's tools in general, not to the
 * one tool whose failure exposed the class.
 */
export const RUN_TMP_SOCKET_HEADROOM = 32;

/** The longest `TMPDIR` a run may be handed and still have room for a socket under it. */
export const RUN_TMPDIR_MAX = SOCKET_PATH_MAX - RUN_TMP_SOCKET_HEADROOM;

/**
 * WHERE THE SHORT ALIAS LIVES. `/tmp` literally, not `os.tmpdir()`: the alias exists ONLY to
 * be short, and reading the variable here would inherit the operator's own long `TMPDIR` —
 * the very thing being routed around. Nothing of the session's is written here; the alias is
 * a name that points beside the log.
 */
const ALIAS_ROOT = "/tmp";

/** How many hex characters of the digest name the alias — 12 keeps `/tmp/aco-…` at 21. */
const ALIAS_DIGEST = 12;

/**
 * THE ALIAS IS NAMED AFTER THE DIRECTORY IT POINTS AT, so it is recognisable as ours without
 * a registry: the same run's tmp always hashes to the same name, and an alias found already
 * there can be checked rather than guessed about.
 */
export const runTmpAliasPath = (realDir: string): string =>
  `${ALIAS_ROOT}/aco-${createHash("sha256").update(realDir).digest("hex").slice(0, ALIAS_DIGEST)}`;

/** Whether a socket can still be opened under this directory. */
export const runTmpFitsSocketBudget = (dir: string): boolean => dir.length <= RUN_TMPDIR_MAX;

export type RunTmpHandover = {
  /** The value to hand the child as `TMPDIR`. */
  readonly handed: string;
  /** The alias made for it, if one was needed — the caller removes it when the run ends. */
  readonly alias?: string;
  /** What the supervisor's log should say. Empty for the ordinary short-path case. */
  readonly lines: readonly string[];
};

/**
 * WHAT THE CHILD IS HANDED AS `TMPDIR`. The real directory when it fits, a short symlink to
 * it when it does not.
 *
 * NOTHING HERE MAY COST A RUN, and nothing here may be silent when it fails: an alias that
 * could not be made means the session will hit `listen EINVAL` in a tool it did not write,
 * with an error naming a path and not a cause. So the fallback is the real directory AND a
 * line that says the number, the budget and what will break — the run continues, and the log
 * answers the question the session cannot.
 */
export const handOverRunTmp = (realDir: string): RunTmpHandover => {
  if (runTmpFitsSocketBudget(realDir)) return { handed: realDir, lines: [] };
  const alias = runTmpAliasPath(realDir);
  const tooLong = `the run's own TMPDIR is ${realDir.length} characters (${realDir}), over the ${RUN_TMPDIR_MAX} a unix socket under it can afford`;
  try {
    symlinkSync(realDir, alias, "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      return {
        handed: realDir,
        lines: [
          `${tooLong}, and the short alias ${alias} could not be made: ${(error as Error).message} — a tool opening a socket in TMPDIR will fail with 'listen EINVAL'`,
        ],
      };
    }
    // ALREADY THERE. The name is this directory's own hash, so the ordinary reason is a
    // previous run of the same session that died before its sweep; re-using it is correct
    // and re-pointing it is not needed. Anything else wearing that name is not ours, and
    // that is refused BY NAME rather than followed.
    let target: string | undefined;
    try {
      target = readlinkSync(alias);
    } catch (readError) {
      return {
        handed: realDir,
        lines: [
          `${tooLong}, and ${alias} is in the way but is not a symlink: ${(readError as Error).message} — a tool opening a socket in TMPDIR will fail with 'listen EINVAL'`,
        ],
      };
    }
    if (target !== realDir) {
      return {
        handed: realDir,
        lines: [
          `${tooLong}, and the short alias ${alias} already points at ${target} — a tool opening a socket in TMPDIR will fail with 'listen EINVAL'`,
        ],
      };
    }
  }
  return {
    handed: alias,
    alias,
    lines: [`${tooLong}, so the session is handed ${alias}, a symlink to it`],
  };
};

/**
 * THE ALIAS GOES WHEN THE RUN GOES. Removing it is not the same act as sweeping the real
 * directory — that one is named and reported, this one is a pointer nobody reads afterwards
 * — but a leftover here accumulates in the shared `/tmp`, which is the place `056` exists to
 * keep clean. A failure to remove is reported and costs the run nothing.
 */
export const dropRunTmpAlias = (alias: string): readonly string[] => {
  try {
    unlinkSync(alias);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [`the run's TMPDIR alias ${alias} could not be removed: ${(error as Error).message}`];
  }
  return [];
};
