/**
 * The conversations index as a REFLECTION of the threads (thread 006).
 *
 * `waiting-on` used to be edited by hand by three parties — curator, the dev
 * agents and the merge notifier — and it drifted from the bodies of the threads.
 * Anything edited by hand in several places drifts by construction, so INDEX is
 * not a source but a derived artifact.
 *
 * And a consequence the bash version did not have: since INDEX is derived, **the
 * circuit must not depend on it**. If the index is rebuilt by CI, a failed build
 * would mean the watch and the keeper stopped seeing mail — pain 5 (thread 008)
 * one to one. Hence "is there mail" is computed from the THREADS (`waitingOnOf`),
 * and INDEX stays a display for humans: its drift costs cosmetics.
 */
import { type Thread, updatedOf, waitingOnOf } from "./thread.js";

const EMPTY = "—";

// The heading is written INTO THE PROJECT ZONE (`INDEX.md` of the mail branch) and
// is therefore deliberately left in the language of that zone: R1 makes the
// package English, but the boundary of R1 is that the project zone is not touched
// — translating it here would rewrite a project artifact on the next rebuild.
const INDEX_HEADING = "# Реестр разговоров";

export const renderIndex = (threads: readonly Thread[]): string => {
  const rows = threads.map((thread) => {
    const waiting = waitingOnOf(thread);
    return `| ${thread.id} | ${thread.meta.participants.join(", ")} | ${thread.meta.status} | ${
      waiting ?? EMPTY
    } | ${updatedOf(thread)} |`;
  });

  return `${INDEX_HEADING}\n\n| id | participants | status | waiting-on | updated |\n|---|---|---|---|---|\n${rows.join(
    "\n",
  )}\n`;
};

/** Threads awaiting a role. This is exactly "is there mail" — computed from the source, not from INDEX. */
export const threadsWaitingOn = (threads: readonly Thread[], role: string): string[] =>
  threads.filter((thread) => waitingOnOf(thread) === role).map((thread) => thread.id);
