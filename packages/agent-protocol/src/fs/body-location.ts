/**
 * THE BODY LOCATION DOOR, WIRED TO A REAL GIT — one wiring for every command of this
 * package that takes a `--body-file` (thread `170-mail-body-inside-checkout`).
 *
 * The judgement is not here: it is `judgeBodyLocation` in `merge/pr-open.ts`, a pure
 * predicate with its own table of cases, and this module is the two git calls that answer
 * its two questions. The split is the reason the predicate is testable without a broken
 * git; the reason THIS file exists is the other half of the same rule.
 *
 * WHY IT IS A FUNCTION AND NOT A PARAGRAPH COPIED THREE TIMES. Until this thread the
 * wiring stood inline inside `prOpen`, and the door it fed was `pr open`'s alone. `new-
 * message` and `new-thread` — the two commands that write into an APPEND-ONLY feed — had
 * no door of that class at all, and the repair is «the same door, the same predicate»
 * (curator's statement of work, §3.2). Copied, it would be a defect by construction: the
 * `LC_ALL=C` that makes git's «not a git repository» recognisable, and the reading of
 * `check-ignore`'s exit code, are decisions that must move in all three callers at once or
 * the doors of one class start disagreeing silently.
 *
 * WHAT IT COSTS THE NORMAL PATH — measured, not hoped for (thread 157, remeasured in 170):
 * the daemon's own letter writers run with no `TMPDIR` in their environment at all, so
 * their `tmpdir()` is `/tmp`, outside every checkout; a raised session's `TMPDIR` is a
 * directory under `.orchestrator/`, which the served repository IGNORES. Both walk past
 * this door without a word. What it refuses is the body left in a served root or in a
 * role's worktree — the artefact that stops the box's self-restart.
 */

import { type BodyLocationVerdict, checkoutAnswerOf, judgeBodyLocation } from "../merge/pr-open.js";
import { execFileSyncByExit } from "./exec-sync.js";
import { gitEnvOutsideHook } from "./git-env.js";

/**
 * Where the body file at `path` lies, as git answers it — the verdict of
 * {@link judgeBodyLocation} over this box's real git.
 *
 * The refusal it returns names the path, the checkout and the way out, and it names no
 * command: the caller prefixes its own name (`pr open — …`, `new-message — …`), because a
 * refusal that cannot say which command produced it is a refusal a reader cannot act on.
 */
export const bodyFileLocation = (path: string): BodyLocationVerdict =>
  judgeBodyLocation({
    path,
    // NOT a reader whose whole failure vocabulary is `undefined`: this door reads «no
    // checkout» as PASS, so a git that could not run at all would silently open the door
    // instead of guarding it. `checkoutAnswerOf` keeps "git looked and found no
    // repository" apart from "git did not answer", and `LC_ALL=C` is what makes the first
    // of those recognisable by its own sentence on any box.
    checkoutOf: (dir) =>
      checkoutAnswerOf(() =>
        execFileSyncByExit("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
          env: { ...gitEnvOutsideHook(), LC_ALL: "C" },
        }),
      ),
    // `check-ignore` exits 0 when the path IS ignored, 1 when it is not, and >1 on an
    // error — and only the first is an answer. Anything else is read as "not ignored",
    // which is the side that refuses: a door that fell silent because git had trouble
    // would be a door that stops guarding without saying so.
    isIgnored: (dir, file) => {
      try {
        execFileSyncByExit("git", ["-C", dir, "check-ignore", "-q", "--", file], {
          env: gitEnvOutsideHook(),
        });
        return true;
      } catch {
        return false;
      }
    },
  });
