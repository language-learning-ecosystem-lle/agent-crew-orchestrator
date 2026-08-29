/**
 * HOW THE MACHINE FINDS THE HOME OF ITS CIRCUIT TODAY (R26).
 *
 * The operational state of the circuit — the journal, the three flags, `holds/`,
 * `sessions/`, the notifier's ledger — and the mail checkout are properties OF THE
 * MACHINE, not of the directory a command was typed in. Until this function existed
 * they were addressed as `join(git rev-parse --show-toplevel, orchestrator.state)`,
 * and in a LINKED WORKTREE `--show-toplevel` answers with the worktree itself. So a
 * command called from a role's workspace (R17 — where, since R17, a raised session
 * always lives) wrote its state into a phantom directory beside the work.
 *
 * It was not a theory. Two `notify.state` ledgers were found on this box, in
 * `.worktrees/dev-core` and `.worktrees/main`, DIVERGED IN CONTENT (009/010/016/019/022
 * against 009/010/016/019/020/023): two duplicate notifications had already gone to a
 * human, and no ledger knew the whole of "already reported". The cheapest symptom is
 * the notifier; the expensive one is `holds/` — a hold taken from a workspace is a hold
 * the daemon cannot see, and it raises a second session on top of a live conversation,
 * which is the very scenario the mechanism was written for.
 *
 * THE ANCHOR is `git rev-parse --git-common-dir`: in every worktree of a repository it
 * answers with the ONE shared git directory, so the checkout that owns it is the same
 * answer from everywhere. That is the whole trick — the state directory hangs off the
 * main checkout, and every worktree agrees on which one it is.
 *
 * THE BOUNDARY THIS MUST NOT SWEEP AWAY. `repoOf` (`--show-toplevel`) is used in TWO
 * senses in the CLI: the base of the state directory, and the repository a config is
 * read from BY REF. The second is correct in a worktree and stays untouched —
 * `config check --ref HEAD` from a feature worktree must check the HEAD of THAT tree,
 * because that is what a reviewer measures with. Hence a separate function rather than
 * "`repoOf` now always returns the main checkout".
 *
 * IT REFUSES RATHER THAN GUESSES. Where the anchor gives no working tree to hang the
 * state on — a bare repository, a git directory kept outside its checkout — the answer
 * is an error with a reason, not a quietly created empty directory. An empty state
 * means "everything is new" to every reader of it, and that is precisely the cost of
 * the defect being fixed here; reproducing it in the repair would be worse than
 * refusing.
 *
 * R25 (venues) note: this does not nail the seam shut. Today's resolution is git-shaped
 * already — what changes here is that it is CORRECT. It lives in one function with this
 * doc block so that a second kind of work surface changes one place, not every call
 * site.
 */
import { basename, dirname, resolve } from "node:path";
import { execFileSyncByExit } from "../fs/exec-sync.js";

/** The anchor did not resolve to a checkout — the caller refuses out loud. */
export class CircuitHomeError extends Error {}

const git = (at: string, args: readonly string[]): string => {
  try {
    // Read path: the child's exit code is the verdict — see `fs/exec-sync.ts`.
    return execFileSyncByExit("git", ["-C", at, ...args]).trim();
  } catch (error) {
    throw new CircuitHomeError(`git ${args.join(" ")} in '${at}': ${(error as Error).message}`);
  }
};

/**
 * The main checkout of the repository `at` belongs to — the same answer from the main
 * checkout and from any of its linked worktrees.
 *
 * `--path-format=absolute` is asked for explicitly: the plain form answers `.git`
 * relative to the caller in the main checkout and an absolute path in a worktree, i.e.
 * the two callers this function exists to reconcile would get different shapes.
 */
export const circuitHome = (at: string): string => {
  if (git(at, ["rev-parse", "--is-bare-repository"]) === "true") {
    throw new CircuitHomeError(
      `'${at}' is a bare repository: it has no working tree for the circuit's state to live in — pass --repo <path> to the checkout that hosts it`,
    );
  }
  const common = resolve(git(at, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  if (basename(common) !== ".git") {
    throw new CircuitHomeError(
      `the git directory of '${at}' is '${common}', which is not a '.git' inside a checkout — the machine's home cannot be derived from it; pass --repo <path> to the checkout that hosts the circuit`,
    );
  }
  return dirname(common);
};
