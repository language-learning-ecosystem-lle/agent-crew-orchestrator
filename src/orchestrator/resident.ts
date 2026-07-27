/**
 * A THREAD WAITING ON A ROLE NOBODY RAISES (R23-1, thread `016-protocol-roadmap`).
 *
 * `wake: resident` says the role is hosted by a process that is already alive, so the
 * circuit deliberately does not raise it. That buys the honest topology answer (R13
 * keeps asking who owns it) and costs the one property every other mode has: A RESIDENT
 * FAILS SILENTLY. A `watch` session that died is repaired by the next tick and the
 * journal shows the attempt; a resident process that died is indistinguishable from a
 * resident process that has not answered yet — the thread simply waits, and the daemon,
 * which never had this role among its candidates, says nothing about it at all.
 *
 * THE ANSWER IS VISIBILITY, NOT LIVENESS. A heartbeat is refused here for the reason
 * already written down in `hold.ts`: an orphaned beating process holds the thing it
 * beats for forever, so "it is alive" is the one claim a heartbeat cannot make
 * truthfully. What this module does instead is state a FACT that is always checkable
 * from the mail alone — this thread waits on this resident role — and put it where the
 * two people who look already look: beside the daemon's queue every tick, and in
 * `orchestrator status`.
 *
 * WHY IT IS NOT A `TickSkip`. A skip is a candidate the tick refused; a resident role
 * never becomes a candidate, because candidates are built from the launchable roles.
 * Injecting it as a skip would mean pretending the tick considered something it cannot
 * consider, and the reason a human needs is not "not launched" but "not ours to
 * launch — go and look at that process".
 */

/** A thread waiting on a role that is hosted rather than raised. */
export type ResidentWait = { readonly role: string; readonly thread: string };

/**
 * The waiting pairs, from the mail this box already read. The residents come from the
 * registry, the waits from the same `threadsWaitingOn` the queue is built with — so a
 * resident wait and a launch candidate can never disagree about who is waiting.
 */
export const residentWaits = (input: {
  readonly residents: readonly string[];
  /** Threads waiting on a role, by role id — the caller's own reader. */
  readonly waitingThreads: (role: string) => readonly string[];
}): readonly ResidentWait[] =>
  input.residents.flatMap((role) => input.waitingThreads(role).map((thread) => ({ role, thread })));

/** One line for the daemon's stream, beside the queue this pair is deliberately not in. */
export const describeResidentWait = (wait: ResidentWait): string =>
  `thread ${wait.thread} waits on ${wait.role}, which this circuit does not raise: the role is RESIDENT — its process is already alive and reads the mail itself. Nothing here will pick this up; if it stays, look at that process.`;

/**
 * The `status` block. It is printed even when EMPTY as long as the project has resident
 * roles at all: "no thread waits on a resident" is the answer to the question, whereas
 * silence is indistinguishable from a `status` that does not know about residents. A
 * project with no resident roles gets nothing — there is no question to answer.
 */
export const renderResidentWaits = (input: {
  readonly residents: readonly string[];
  readonly waits: readonly ResidentWait[];
}): string | undefined => {
  if (input.residents.length === 0) return undefined;
  const lines = [`resident roles (hosted, never raised): ${input.residents.join(", ")}`];
  if (input.waits.length === 0) {
    lines.push("  no thread is waiting on any of them");
    return lines.join("\n");
  }
  for (const wait of input.waits) {
    lines.push(`  ⏳ ${wait.thread} waits on ${wait.role} — its process answers, not the circuit`);
  }
  return lines.join("\n");
};
