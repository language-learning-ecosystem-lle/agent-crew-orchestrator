/**
 * The orchestrator `status` — a readable view of the folded lease (step S0,
 * thread 012). A pure function: the lease has already been folded by
 * `foldLeases`, only formatting happens here. The point of the step is to see
 * both gaps in the data BEFORE any spawn: `overdue` (stuck) and `exhausted` (the
 * attempt ceiling) are called out as explicit marks instead of hiding inside the
 * state column.
 */
import type { LeaseView } from "./lease.js";

/** A mark on a problem state of the pair — what the operator must not miss. */
const flag = (view: LeaseView): string => {
  if (view.exhausted)
    return "  ⚠ EXHAUSTED — no more attempts until the pair delivers again (a completed run or a handoff resets the count), see the journal";
  if (view.overdue) return "  ⚠ OVERDUE — the deadline has passed, the lease is still alive";
  return "";
};

const line = (view: LeaseView): string => {
  const cols = [
    view.role,
    view.thread,
    view.state,
    // The count AND what it is judged against: "attempt 13" left an operator to guess
    // both the ceiling and whether their `--max-attempts` had arrived at all.
    `attempt ${view.attempt}/${view.ceiling}`,
    view.deadline === null ? "deadline —" : `deadline ${view.deadline}`,
    view.reason === null ? "" : `(${view.reason})`,
  ]
    .filter((c) => c !== "")
    .join("  ·  ");
  return `${cols}${flag(view)}`;
};

/**
 * State lines for every (role, thread) pair. An empty lease set produces an
 * honest "no active sessions" line rather than empty output: silence is
 * indistinguishable from a failure to read the journal (the P0 lesson), so the
 * absence of sessions is spelled out.
 */
export const renderStatus = (views: readonly LeaseView[]): string => {
  if (views.length === 0) return "orchestrator: no sessions in the journal";
  return views.map(line).join("\n");
};
