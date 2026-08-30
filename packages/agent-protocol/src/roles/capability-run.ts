/**
 * THE SURFACE OF A CALL — the half `capability-call.ts` left at its end: something that RAISES a
 * call and RUNS the plan the door resolved (thread `047-devops-role`, curator's statement of work
 * of 2026-08-30 §5, unblocked by his §1 of the same day: the surface is a command of the package
 * and needs no new entry in the permission vocabulary — `roles[].capabilities` of
 * `agent-protocol.json` is where a capability is already entitled, and that file is a document of
 * power already).
 *
 * TWO CONDITIONS CAME WITH THAT ANSWER AND THEY ARE PART OF THE SUBJECT, not a footnote:
 *   1. this surface NEVER raises an identity — no `sudo`, no `su`, no `-u`, no reading of
 *      `systemUser` anywhere below. The identity arrives from OUTSIDE: the session is already
 *      spawned as the declared user by `resolveSpawnIdentity` (`orchestrator/launch.ts`, §0.1a of
 *      `docs/box-setup.md`). A command that switched the user itself would be a new right, and no
 *      answer of curator's covers it;
 *   2. `agent-protocol.json` is not touched at all — no key, no permission, no version.
 * Both are visible in one grep over this file, which is why they are written here and not only in
 * the PR that brought it.
 *
 * WHY THE EXECUTION IS HERE AND NOT IN `cli.ts`. The door returns a plan of literals; running it is
 * IO, and IO written inline at the call site is IO no test can stand in front of. Everything below
 * takes its world as arguments — the runner of a step, the reader of a checkout's cleanliness, the
 * writer of the trace, the clock — so the unit tests assert the one thing that matters most about
 * `--write`: that without it the runner was NOT CALLED, rather than that the output looked like a
 * plan.
 *
 * THE REFUSAL OF THE DOOR TRAVELS VERBATIM. Nothing here paraphrases, shortens or replaces it with
 * an exit code: the whole worth of the previous half is in the words of its refusals, and a surface
 * that swallowed them would zero it out entirely (curator's §5 p.3).
 */
import type { CapabilityCall, CapabilityStep } from "./capability-call.js";
import { resolveCapabilityCall } from "./capability-call.js";
import type { Role } from "./schema.js";

/** What running one step said. `error` is the spawn failing to happen at all (no such binary). */
export type StepOutcome = {
  readonly code: number;
  readonly error?: string;
};

/** Runs one resolved step. The only place the outside world is touched, and it is injected. */
export type StepRunner = (step: CapabilityStep) => StepOutcome;

/**
 * THE STATE OF A CHECKOUT `repo-refresh` is aimed at. `unreadable` is a third case on purpose: a
 * directory whose cleanliness cannot be established is not the same as a clean one, and the branch
 * that treated it as clean would move a tree it never looked at.
 */
export type CheckoutState =
  | { readonly kind: "clean" }
  | { readonly kind: "dirty"; readonly entries: readonly string[] }
  | { readonly kind: "unreadable"; readonly detail: string };

export type CheckoutReader = (checkout: string) => CheckoutState;

/** Where the trace of a state-changing call is appended. One line, already composed. */
export type TraceWriter = (line: string) => void;

export type CapabilityRun =
  | {
      readonly ok: true;
      /** `false` when the call changes state and `--write` was not passed: nothing ran. */
      readonly ran: boolean;
      /**
       * WHETHER A TRACE WAS APPENDED — said by this outcome rather than inferred by the caller from
       * `ran`, because two of the three verbs only read and leave none: a surface that printed
       * "trace: <path>" after `df` would be pointing at a file where nothing about that call is
       * written, which is worse than printing nothing.
       */
      readonly traced: boolean;
      readonly report: readonly string[];
    }
  | { readonly ok: false; readonly refusal: string };

const rendered = (step: CapabilityStep): string => [step.command, ...step.argv].join(" ");

/**
 * A DIRTY CHECKOUT IS REFUSED BY NAME, never repaired. Stated by curator twice (§3 p.4 of
 * 2026-08-30 and §5 p.6) and it is the one move nobody could undo: `git pull --ff-only` into a tree
 * holding somebody's uncommitted work either fails halfway or silently carries it onto a new base,
 * and both are somebody else's hours. The refusal names the entries because "dirty" without them
 * sends its reader to look for what it already knew.
 */
export const dirtyCheckoutRefusal = (input: {
  readonly role: Role;
  readonly checkout: string;
  readonly entries: readonly string[];
}): string =>
  `role '${input.role.id}' may not run 'repo-refresh' on '${input.checkout}': the checkout holds uncommitted work — ${input.entries.join(", ")}. A capability does not repair somebody else's tree; committing, stashing or discarding it is a decision with an owner, and this one is not it. Repair: land or stash the work in that checkout by hand, then call again.`;

/** The same door, for a checkout whose state could not be read at all. */
export const unreadableCheckoutRefusal = (input: {
  readonly role: Role;
  readonly checkout: string;
  readonly detail: string;
}): string =>
  `role '${input.role.id}' may not run 'repo-refresh' on '${input.checkout}': the state of that checkout could not be read — ${input.detail}. A directory whose cleanliness is unknown is not a clean one, and refreshing it would move a tree nobody looked at. Repair: check that the path is a git checkout this user may read, or fix the declared value in 'roles[].capabilities' of agent-protocol.json.`;

/**
 * A STEP THAT FAILED IS NOT A CALL THAT SUCCEEDED. The refusal names the step by its number, the
 * command as it ran and the code it returned, and — for `repo-refresh`, whose verb is two commands
 * — says WHICH steps did not run because of it. A first step that failed must not be followed by
 * the second: a `pnpm install` after a failed `git pull --ff-only` installs against a tree that is
 * not the one anybody asked for, and its zero exit would read as a refresh that worked.
 */
export const stepFailureRefusal = (input: {
  readonly role: Role;
  readonly capability: string;
  readonly index: number;
  readonly total: number;
  readonly step: CapabilityStep;
  readonly outcome: StepOutcome;
  readonly skipped: readonly CapabilityStep[];
}): string => {
  const said =
    input.outcome.error === undefined
      ? `exit code ${input.outcome.code}`
      : `it could not be run at all — ${input.outcome.error}`;
  const skipped =
    input.skipped.length === 0
      ? "It was the last step, so nothing was skipped."
      : `The remaining ${input.skipped.length} step(s) did NOT run: ${input.skipped.map(rendered).join(" ; ")} — a later step on the outcome of a failed earlier one would report a success about a state nobody produced.`;
  return `role '${input.role.id}' ran '${input.capability}' and step ${input.index + 1} of ${input.total} failed: '${rendered(input.step)}' — ${said}. ${skipped} Repair: run that command by hand in the same place to see what it says; the call is not retried for you.`;
};

/**
 * THE TRACE, and the reason it is composed out of `plan.trace` rather than out of what this
 * function remembers doing. `plan.trace` is built by the door from the same resolved values the
 * steps are, so the line cannot describe a different call than the one that ran. What is added here
 * is what only the surface knows: WHEN, BY WHOM (the system identity that carried the call — it
 * arrived from outside, this file never sets it) and HOW IT ENDED. An outsider reading this file
 * alone establishes all four without the session transcript, which was the requirement: a
 * transcript lies in `daemon.log` mixed with everybody else's and survives rotation worse.
 */
export const capabilityTraceLine = (input: {
  readonly at: string;
  readonly by: string;
  readonly trace: string;
  readonly outcome: string;
}): string => `${input.at} · by ${input.by} · ${input.trace} · outcome ${input.outcome}`;

export const runCapabilityCall = (input: {
  readonly role: Role;
  readonly call: CapabilityCall;
  /** The package's house rule: a call that changes state does nothing at all without it. */
  readonly write: boolean;
  readonly run: StepRunner;
  readonly checkoutState: CheckoutReader;
  readonly trace: TraceWriter;
  /** The identity this process already has. Read, never set — see the head of the file. */
  readonly by: string;
  readonly at: string;
}): CapabilityRun => {
  const resolved = resolveCapabilityCall({ role: input.role, call: input.call });
  if (!resolved.ok) {
    // VERBATIM — not shortened, not re-worded, not replaced by a code.
    return { ok: false, refusal: resolved.refusal };
  }
  const plan = resolved.plan;
  const lines = plan.steps.map((step, index) => `  step ${index + 1}: ${rendered(step)}`);

  if (plan.changesState && !input.write) {
    return {
      ok: true,
      ran: false,
      traced: false,
      report: [
        `capability '${plan.capability}' of role '${input.role.id}' changes the box, so this is a PLAN and nothing was run.`,
        ...lines,
        `trace it would leave: ${plan.trace}`,
        "Pass --write to run it.",
      ],
    };
  }

  if (plan.changesState) {
    // The target is a member of the declared closed list by the door above — so this asks about a
    // checkout the card named, never about a path the caller handed in.
    const checkout = plan.steps[0]?.argv[1] as string;
    const state = input.checkoutState(checkout);
    if (state.kind === "dirty") {
      return {
        ok: false,
        refusal: dirtyCheckoutRefusal({ role: input.role, checkout, entries: state.entries }),
      };
    }
    if (state.kind === "unreadable") {
      return {
        ok: false,
        refusal: unreadableCheckoutRefusal({
          role: input.role,
          checkout,
          detail: state.detail,
        }),
      };
    }
  }

  const done: string[] = [];
  for (const [index, step] of plan.steps.entries()) {
    const outcome = input.run(step);
    if (outcome.code !== 0 || outcome.error !== undefined) {
      const refusal = stepFailureRefusal({
        role: input.role,
        capability: plan.capability,
        index,
        total: plan.steps.length,
        step,
        outcome,
        skipped: plan.steps.slice(index + 1),
      });
      // THE TRACE OF A FAILED CALL IS STILL A TRACE. The obligation is "what was done to the box",
      // and a `git pull` that died halfway did something to it; a journal that recorded only the
      // calls that worked would be a journal one cannot use to explain a broken checkout.
      if (plan.changesState) {
        input.trace(
          capabilityTraceLine({
            at: input.at,
            by: input.by,
            trace: plan.trace,
            outcome: `FAILED at step ${index + 1} of ${plan.steps.length} (${rendered(step)}${outcome.error === undefined ? `, code ${outcome.code}` : `, ${outcome.error}`})`,
          }),
        );
      }
      return { ok: false, refusal };
    }
    done.push(`  step ${index + 1} ok: ${rendered(step)}`);
  }

  if (plan.changesState) {
    input.trace(
      capabilityTraceLine({ at: input.at, by: input.by, trace: plan.trace, outcome: "ok" }),
    );
  }
  return {
    ok: true,
    ran: true,
    traced: plan.changesState,
    report: [
      `capability '${plan.capability}' of role '${input.role.id}' ran ${plan.steps.length} step(s).`,
      ...done,
    ],
  };
};
