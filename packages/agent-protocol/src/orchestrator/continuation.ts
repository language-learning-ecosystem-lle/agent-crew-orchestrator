/**
 * CONTINUATION POLICY (R18, thread `016-protocol-roadmap`, john's decision) — when a
 * broken run is RESUMED and when it is started afresh.
 *
 * The tool has been able to do it all along (`claude --resume <session id>`), and
 * since R7 everything needed to ask for it is written down: the session id is in the
 * journal and in the header of every message the session wrote. What was missing was
 * the rule, and a rule is the whole of it — a resume is not "cheaper", it is a
 * DIFFERENT RUN, one that carries the previous session's reasoning into a world that
 * may have changed underneath it.
 *
 * THE ASYMMETRY THAT SETS THE DEFAULT. Fresh is always correct: the session reads the
 * thread, sees the tree as it is, and starts. Resume is correct only under conditions.
 * So resume lives behind a guard and fresh is the fallback of every branch — including
 * every branch where we simply do not know.
 *
 * THE THREE CONDITIONS, in the order they are checked:
 *
 *  1. **The break was EXTERNAL, not exhaustion.** `supervisor-gone` (the observer
 *     died — a laptop lid, a SIGTERM, a machine going down) and `stalled` (no traces
 *     of activity: a hung IO, a network that went away) say nothing about the
 *     session's own reasoning being stuck. `timeout` and a run that walked into
 *     `--max-turns` say exactly that: resuming them would put the same session back
 *     into the same tightness it just failed to get out of, and the second attempt
 *     would break at the same place with more spent.
 *  2. **The world has not moved** (john named this one as obligatory, and NARROWED it
 *     on 2026-07-25 after the first version shipped). The first version compared the
 *     TREE of the thread directory, and that criterion fired on the most ordinary
 *     event there is: an answer. New messages from OTHER participants are the INPUT
 *     the session was waiting for — a resumed session reads them exactly as a fresh
 *     one would, and refusing to continue because the answer arrived is the one
 *     refusal that costs a whole run and buys nothing. What is a shift:
 *       a. **somebody spoke for it** — a message of the SAME ROLE from ANOTHER session
 *          appeared in the thread. Then the work may already have been done, or
 *          redecided, by a run that shares nothing with this one but the role card;
 *       b. **the base moved** — a merge into `main` while the session was down
 *          (including the merge of its OWN pull request) puts its work on top of
 *          something that no longer exists.
 *     Rewriting the statement of work behind its back is impossible by construction:
 *     the feed is append-only, which is why nothing here guards against it.
 *  3. **The previous run was YOUNG.** The value of a resume is the work already done;
 *     its cost is the context that comes back with it. Live numbers from this
 *     repository's own runs (2026-07-25, six packages): a full package burns 183–302
 *     assistant steps. A run that broke under `YOUNG_RUN_STEPS` had time to read the
 *     thread and start, which is the work worth saving while the context is still
 *     small; a run that broke at 250 brings back the very context that got tight.
 *
 * WHAT IS NOT A CONDITION, AND WHY. Time since the break: it decides nothing on its
 * own — an hour in which nothing happened leaves the world exactly as it was, and a
 * minute in which a PR was merged does not. Condition 2 measures the thing the clock
 * was standing in for.
 *
 * WHAT CONDITION 2b DOES NOT SEE, said plainly: a foreign push onto the feature branch
 * the broken session was working on. The branch has no name anybody but that session
 * knows, so there is nothing to look up; the case john named — its own PR being merged
 * — is the base moving, and that is checked. The local tree is defended by a different
 * mechanism entirely (the workspace lock of R17), not by this policy.
 *
 * EVERY DECISION IS PRINTED WITH ITS REASON. A silent policy is unauditable, and this
 * one decides how somebody else's money is spent: `resume: nobody worked in its place
 * and the base has not moved, the break was external (supervisor-gone, 41 steps)` /
 * `fresh: the base branch has moved on`.
 */
import type { OrchestratorEvent, ReleaseReason, World } from "./journal.js";

/**
 * THE BREAKS THAT MAY BE CONTINUED. Two, and everything else is fresh — including
 * `forced` (a human ended that run; resurrecting it would undo a decision that was
 * taken on purpose) and `exited-without-handoff`, which covers both a crash and a run
 * that used up `--max-turns` and is indistinguishable between them from the outside.
 * Where the two cannot be told apart, the answer is the safe one.
 */
export const RESUMABLE_REASONS: readonly ReleaseReason[] = ["supervisor-gone", "stalled"];

/**
 * THE CEILING OF A "YOUNG" RUN, in assistant steps of the session stream.
 *
 * 80, and the number comes from this repository's own journal rather than from taste:
 * the six real packages of 2026-07-25 took 183, 209, 225, 245, 302 steps, while the
 * orientation phase of a run — reading the thread, the statement of work and the code
 * it touches — costs about 58. So 80 sits above "it had only just started" and below
 * half of the shortest package there has been. Calibratable: it is one constant, and
 * the reason it exists is written above it.
 */
export const YOUNG_RUN_STEPS = 80;

/** What the journal remembers about the last run of a (role, thread) pair. */
export type PreviousRun = {
  /** How it ended. `null` while the run is still going (no release yet). */
  readonly reason: ReleaseReason | null;
  /** The id to hand to `--resume`, if the session ever announced one. */
  readonly session?: string;
  /** Assistant steps seen in its stream. */
  readonly steps?: number;
  /** The world it started from — the two ids condition 2 compares against. */
  readonly world?: World;
};

export type Continuation =
  | { readonly mode: "resume"; readonly session: string; readonly why: string }
  | { readonly mode: "fresh"; readonly why: string };

/**
 * A message the role wrote in the thread ITSELF — the only messages condition 2a
 * reads. `file` is the identity (the feed is append-only, so a name is stable and
 * unique) and `session` is the run that wrote it.
 *
 * `session` absent means the message is NOT SIGNED by any run: a human writing on the
 * role's behalf, a job, a message older than provenance. That is unknown, and unknown
 * is read as "somebody else" — the same direction every other gap in this policy falls
 * in.
 */
export type OwnMessage = {
  readonly file: string;
  readonly session?: string;
};

/**
 * Condition 2a: has anybody spoken FOR this role since the run started? Returns the
 * sentence for a `fresh`, or `undefined` when the answer is a clean no.
 *
 * The mark (`mine`, the role's own last message at launch) is what makes this a
 * question about the INTERVAL rather than about the whole thread: the role's messages
 * from earlier packages were written by long-dead sessions and mean nothing here. A
 * mark that is no longer in the thread is not a shift and not a non-shift — it is a
 * feed that cannot be read the way this policy needs, so it falls to fresh like every
 * other unknown.
 */
const spokenForIt = (input: {
  readonly own: readonly OwnMessage[];
  readonly mine: string;
  readonly session: string;
}): string | undefined => {
  let newer: readonly OwnMessage[];
  if (input.mine === "") {
    newer = input.own; // the role had said nothing at launch: everything of its own is new
  } else {
    const at = input.own.findIndex((message) => message.file === input.mine);
    if (at === -1) {
      return `its own last message at launch ('${input.mine}') is no longer in the thread — what has appeared since cannot be told apart`;
    }
    newer = input.own.slice(at + 1);
  }
  // `!==` and not a check for undefined: an unsigned message of this role is as much
  // "not our session" as a signed one from a different id.
  const foreign = newer.find((message) => message.session !== input.session);
  return foreign === undefined
    ? undefined
    : `another session wrote for this role while it was down ('${foreign.file}') — the work may already have been done or redecided`;
};

/**
 * The last run of a pair, read off the journal. Only the LAST one matters: a resume
 * continues one session, and an older break is a different session in a different
 * world.
 *
 * The scan is forward with overwriting rather than backward with an early exit,
 * because the facts of one run are spread across two events (`launch` carries the
 * world, `lease-released` carries the id and the count) and a `lease-acquired` in
 * between marks where a new run begins.
 */
export const previousRun = (
  events: readonly OrchestratorEvent[],
  role: string,
  thread: string,
): PreviousRun | undefined => {
  let current: PreviousRun | undefined;
  for (const event of events) {
    if (event.role !== role || event.thread !== thread) continue;
    switch (event.kind) {
      case "lease-acquired":
        current = { reason: null };
        break;
      case "launch":
        if (current !== undefined && event.world !== undefined) {
          current = { ...current, world: event.world };
        }
        break;
      case "lease-released":
        if (current !== undefined) {
          current = {
            ...current,
            reason: event.reason,
            ...(event.session === undefined ? {} : { session: event.session }),
            ...(event.steps === undefined ? {} : { steps: event.steps }),
          };
        }
        break;
      case "stop":
        // A forced stop is terminal too, and it is not resumable — recorded as such
        // rather than left looking like a run still in flight.
        if (current !== undefined) current = { ...current, reason: "forced" };
        break;
      default:
        break;
    }
  }
  return current;
};

/**
 * The decision. Pure, and every path returns the sentence that will be printed —
 * building the reason next to the branch that produced it is what keeps the two from
 * drifting apart.
 */
export const planContinuation = (input: {
  readonly previous?: PreviousRun;
  /** The world as it is NOW; absent when the circuit could not read it (then: fresh). */
  readonly world?: World;
  /**
   * The role's own messages in the thread as it is NOW, in thread order — condition
   * 2a. Absent when the thread could not be read at all (a legacy `_thread.md`, which
   * carries neither file identity nor sessions): then, fresh.
   */
  readonly own?: readonly OwnMessage[];
  /** `--fresh`: the operator overrides the policy for this run. */
  readonly forceFresh?: boolean;
  readonly youngSteps?: number;
}): Continuation => {
  const young = input.youngSteps ?? YOUNG_RUN_STEPS;
  const previous = input.previous;

  if (input.forceFresh === true) return { mode: "fresh", why: "--fresh was given" };
  if (previous === undefined || previous.reason === null) {
    return { mode: "fresh", why: "there is no finished previous run of this pair" };
  }
  if (!RESUMABLE_REASONS.includes(previous.reason)) {
    return {
      mode: "fresh",
      why: `the previous run ended as '${previous.reason}' — that is exhaustion or a decision, not an external abort`,
    };
  }
  if (previous.session === undefined) {
    return {
      mode: "fresh",
      why: "the previous run recorded no session id — there is nothing to resume",
    };
  }
  if (previous.world === undefined || input.world === undefined) {
    return {
      mode: "fresh",
      why: "the world of the previous run was not recorded — it cannot be shown to be unchanged",
    };
  }
  // 2a — somebody spoke for it. Before the base check because it is the sharper of the
  // two: a moved base costs a rebase, a run that worked in this one's place may have
  // made the whole package moot.
  if (previous.world.mine === undefined) {
    return {
      mode: "fresh",
      why: "the previous run recorded no mark of its own last message — what has been written for this role since cannot be told apart",
    };
  }
  if (input.own === undefined) {
    return {
      mode: "fresh",
      why: "the thread's own messages could not be read — nobody can be shown not to have worked in its place",
    };
  }
  const spoken = spokenForIt({
    own: input.own,
    mine: previous.world.mine,
    session: previous.session,
  });
  if (spoken !== undefined) return { mode: "fresh", why: spoken };
  // 2b — the ground it stands on.
  if (previous.world.base !== input.world.base) {
    return { mode: "fresh", why: "the base branch has moved on since the previous run" };
  }
  if (previous.steps === undefined) {
    return {
      mode: "fresh",
      why: "how much the previous run burned was not recorded — it cannot be shown to be young",
    };
  }
  if (previous.steps >= young) {
    return {
      mode: "fresh",
      why: `the previous run burned ${previous.steps} steps (the ceiling of a young run is ${young}) — its context is what got tight`,
    };
  }
  return {
    mode: "resume",
    session: previous.session,
    why: `nobody worked in its place, the base has not moved, and the break was external ('${previous.reason}', ${previous.steps} steps)`,
  };
};

/** The one line printed before the launch: what was decided and why. */
export const describeContinuation = (continuation: Continuation): string =>
  continuation.mode === "resume"
    ? `resume ${continuation.session}: ${continuation.why}`
    : `fresh: ${continuation.why}`;
