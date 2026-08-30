/**
 * THE DOOR OF A CALL — what happens when somebody asks a role to DO one of the verbs its card
 * declares (thread `047-devops-role`, curator's queue of 2026-08-30: «исполнитель вызова по трём
 * глаголам — с отказами по имени и следом каждого вызова»).
 *
 * `roles/capabilities.ts` is the door of the DECLARATION: it judges what a card may say, and its
 * refusals are the ones a declaration can get wrong (a verb nobody declared, an empty closed list,
 * a parameter belonging to another verb). It says in its own head that the refusals of a CALL —
 * «возможность не объявлена», «параметр вне списка», «цель не объявлена» — belong to a later tact.
 * This file is that tact, and the three refusals below are those three by name.
 *
 * THE ONE DISTINCTION THE WHOLE ROW STANDS ON is the one record `016` drew: a verb is not an
 * access. It survives to here only if the CALL is resolved against the DECLARATION and never
 * against its own words. So a call arrives as free text — a name that may be nonsense, a target
 * that may be anything — and nothing in it reaches a command line unless the card already
 * contained that exact string. `target` is compared to the closed list by equality, not by prefix,
 * not by `resolve`, not by a check that it "is inside" a declared directory: a containment test is
 * an argument about paths (`..`, symlinks, a bind mount), and an argument is the thing an access
 * disguised as a verb wins.
 *
 * WHY THIS FILE STOPS AT THE COMMAND AND DOES NOT RUN IT. What it returns is a PLAN: the steps,
 * in order, each already a resolved binary and an argv of literals, plus the one line the call
 * leaves behind. Running it is IO and belongs beside the spawn, for the reason `launch.ts` keeps
 * its argv pure: a command assembled inline at the point of spawn is a command nothing checks, and
 * these commands are the ones that touch the box. The surface that RAISES a call (which command of
 * the CLI carries it, and whether that surface needs a permission in `agent-protocol.json` — a
 * document of power, and so john's word) is not decided here and is not decided by this build; see
 * the note at the end of the file.
 *
 * NOTHING HERE READS THE ROLE'S STATUS. `devops` is `planned` and no caller exists yet, so a door
 * that also asked "is this role switched on" would be answering a question nobody has asked it in
 * a place nobody reaches. The status is the launch door's (`launch.ts`), it already refuses by
 * name, and one fact checked in two places is one fact that drifts.
 */
import type { Capability, CapabilityName } from "./capabilities.js";
import { CAPABILITY_NAMES } from "./capabilities.js";
import type { Role } from "./schema.js";

/**
 * A CALL AS IT ARRIVES — free text on purpose. `name` is a `string` and not a `CapabilityName`
 * because a call comes from outside (a mail body, a flag, another process) and the whole point of
 * the first refusal is to answer a name that is NOT a member of the vocabulary. A type that made
 * the wrong name unrepresentable would move the refusal to whoever parses the input, which is
 * exactly where it stops being one door and becomes several.
 */
export type CapabilityCall = {
  readonly name: string;
  /** The log to read or the checkout to refresh. Absent for a verb that aims at nothing. */
  readonly target?: string;
  /** `log-tail` only: how much of the tail. Absent means "as much as the card allows". */
  readonly lines?: number;
};

/** One resolved step of a plan: a binary and an argv of literals, nothing to be expanded later. */
export type CapabilityStep = {
  readonly command: string;
  readonly argv: readonly string[];
};

export type CapabilityPlan = {
  readonly capability: CapabilityName;
  /** In order, and all of them: `repo-refresh` is two commands and always was (its declaration). */
  readonly steps: readonly CapabilityStep[];
  /**
   * WHETHER THIS CALL CHANGES THE BOX — the property that decides whether the trace below is a
   * courtesy or an obligation. Two of the three verbs only read (`log-tail`, `disk-free`);
   * `repo-refresh` moves a working tree somebody else may be standing in.
   */
  readonly changesState: boolean;
  /**
   * THE TRACE — one line, and the whole point of it is that it is built HERE rather than by the
   * caller who will write it down. A trace composed at the call site describes what that caller
   * MEANT to run; this one is composed out of the same resolved values the steps are, so a call
   * whose trace and whose command disagree cannot be assembled. It names the role, the verb, the
   * target as the card spells it and every command that will run.
   */
  readonly trace: string;
};

export type CapabilityResolution =
  | { readonly ok: true; readonly plan: CapabilityPlan }
  | { readonly ok: false; readonly refusal: string };

const quoted = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(", ");

/**
 * REFUSAL ONE — «возможность не объявлена». It has two shapes, and the difference between them is
 * the difference between two different repairs: a role that declares NO capabilities at all is a
 * role nobody ever gave this power to (edit the card), while a role that declares two of three is
 * one somebody deliberately narrowed (ask before widening). Both quote what IS declared, and both
 * quote the vocabulary when the asked-for name is not even a verb — "unknown capability" without
 * the set is a refusal its reader cannot act on.
 */
export const capabilityNotDeclaredRefusal = (role: Role, name: string): string => {
  const declared = (role.capabilities ?? []).map((c) => c.name);
  const known = CAPABILITY_NAMES.includes(name as CapabilityName);
  const head =
    declared.length === 0
      ? `role '${role.id}' declares no capabilities at all, so there is nothing it may be asked to do to the box`
      : `role '${role.id}' does not declare the capability '${name}' — it declares ${quoted(declared)}`;
  const vocabulary = known
    ? ""
    : ` The name '${name}' is not a capability of this protocol either; the vocabulary is ${quoted([...CAPABILITY_NAMES])}.`;
  return `${head}.${vocabulary} A call is answered from the card, never from the call: the verb has to stand in 'roles[].capabilities' of agent-protocol.json before it can be asked for, and putting it there is a PR to a document of power (thread 047-devops-role).`;
};

/**
 * REFUSAL TWO — «цель не объявлена», in the shape it takes when the call names NO target at all,
 * or names one where the verb aims at nothing. Both are the same defect from the door's side: the
 * call and the verb disagree about whether there is something to aim at, and a door that guessed
 * (picked the first of the list, ignored the extra word) would be inventing the caller's intent.
 */
export const capabilityTargetShapeRefusal = (input: {
  readonly role: Role;
  readonly capability: Capability;
  readonly call: CapabilityCall;
  readonly parameter: string | undefined;
}): string => {
  const { role, capability, call, parameter } = input;
  if (parameter === undefined) {
    return `the capability '${capability.name}' of role '${role.id}' takes no target, and this call names '${call.target ?? ""}': there is nothing to aim it at, so a call that aims is a call about a different verb. Repair: drop the target, or name the verb you meant (${quoted([...CAPABILITY_NAMES])}).`;
  }
  return `the call of '${capability.name}' by role '${role.id}' names no target, and this verb has one: its closed list '${parameter}' holds ${quoted(closedListOf(capability))}. A door that picked one for you would be choosing which ${parameter === "logs" ? "journal is read" : "checkout is moved"}, and that choice is the caller's. Repair: name one of the values above exactly as the card spells it.`;
};

/**
 * REFUSAL THREE — «параметр вне списка». The refusal quotes the whole list rather than saying "not
 * allowed", because the caller's next move is to pick a member of it, and because a value that
 * LOOKS like a member (the same checkout by a symlink, a relative path, a trailing slash) is
 * refused here by exactly the same words as nonsense — equality is the whole rule, and the reader
 * has to be able to see that it is equality and not a judgement about paths.
 */
export const capabilityTargetNotDeclaredRefusal = (input: {
  readonly role: Role;
  readonly capability: Capability;
  readonly target: string;
  readonly parameter: string;
}): string =>
  `role '${input.role.id}' may not aim '${input.capability.name}' at '${input.target}': the closed list '${input.parameter}' of its card holds ${quoted(closedListOf(input.capability))}, and membership is EQUALITY — a value that merely resembles a declared one (a relative path, a symlink to it, a trailing slash) is outside the list, because a door that argued about paths would be an access wearing a verb's name (thread 047-devops-role, record 016). Repair: call with one of the declared values, or widen the list by a PR to agent-protocol.json.`;

/** The values a verb's own closed list holds — empty for a verb that has no parameter. */
const closedListOf = (capability: Capability): readonly string[] => {
  switch (capability.name) {
    case "log-tail":
      return capability.logs;
    case "repo-refresh":
      return capability.checkouts;
    default:
      return [];
  }
};

/** The name of a verb's closed list, or `undefined` when it aims at nothing. */
export const capabilityParameter = (name: CapabilityName): string | undefined => {
  switch (name) {
    case "log-tail":
      return "logs";
    case "repo-refresh":
      return "checkouts";
    default:
      return undefined;
  }
};

/**
 * THE CEILING OF `log-tail`, refused by name rather than clamped. Clamping is the tempting move —
 * the caller gets an answer, just a shorter one — and it is the one that makes the ceiling
 * invisible: a call for 5000 lines that quietly returns 200 reads, to whoever wrote it, as a box
 * with a short journal. The ceiling of the CARD is what holds here (`maxLines`), and the ceiling
 * of the PROTOCOL (`LOG_TAIL_MAX_LINES`) already refused the card that asked for more.
 */
export const capabilityLinesRefusal = (input: {
  readonly role: Role;
  readonly asked: number;
  readonly maxLines: number;
}): string =>
  `role '${input.role.id}' asked 'log-tail' for ${input.asked} lines and its card allows ${input.maxLines}: the ceiling is refused rather than trimmed, because a call that silently returns fewer lines than it asked for reads as a shorter journal instead of a narrower right. Repair: ask for ${input.maxLines} or fewer, or raise 'maxLines' in the card by a PR to agent-protocol.json.`;

/**
 * A TARGET THE EXECUTOR CANNOT READ — the one refusal that is about neither the call nor the card
 * but about the distance between this build and the prose that composed the card. The head of
 * `capabilities.ts` describes `logs` as «a daemon log of a circuit by path, a journal by the unit
 * it belongs to», and this executor reads FILES: it tails a path. A unit name would need
 * `journalctl`, and the journal of a user unit is unreachable from a separate identity without
 * root or polkit — which is the same wall that struck `service-restart` and `service-status` off
 * the set on 2026-08-30. So a declared non-path is not run as if it were one, and it is not
 * guessed at: it is refused with the two ways out named.
 */
export const capabilityTargetUnreadableRefusal = (input: {
  readonly role: Role;
  readonly target: string;
}): string =>
  `role '${input.role.id}' declares the 'log-tail' target '${input.target}', and this executor reads files: it tails an absolute path. A journal by unit name would need 'journalctl', and the journal of a user unit is not readable by a separate identity without root or a polkit rule — the same wall that struck 'service-restart' and 'service-status' off the set (thread 047-devops-role, john ~08:15Z of 2026-08-30). Repair: declare the log by absolute path, or bring the journal reader as a new capability with john's word, which is where a right of that size belongs.`;

/**
 * HOW A CALL BECOMES A COMMAND — one place, pure, and the only place any of these three verbs is
 * spelled out. Every argv below ends the option list before the target (`--`, or a form with no
 * option after it): the target is a literal that came out of the card, and a card is edited by PR,
 * but a value that begins with a dash and is read as a flag is the oldest way for a verb to grow
 * an argument it was never declared to take.
 */
const stepsFor = (input: {
  readonly capability: Capability;
  readonly target: string | undefined;
  readonly lines: number | undefined;
}): readonly CapabilityStep[] => {
  const { capability, target } = input;
  switch (capability.name) {
    case "log-tail":
      return [
        {
          command: "tail",
          argv: ["-n", String(input.lines ?? capability.maxLines), "--", target as string],
        },
      ];
    case "repo-refresh":
      // TWO COMMANDS, AND THE VERB IS BOTH OF THEM (the declaration: «`git pull --ff-only` +
      // `pnpm install` in a named checkout, and NOTHING else»). `-C` and `--dir` rather than a
      // `cwd`: the directory is then part of the command a reader sees in the trace, instead of
      // an invisible property of the process that ran it. `--ff-only` is not a flag of taste —
      // it is the difference between a refresh and a merge somebody has to resolve.
      return [
        { command: "git", argv: ["-C", target as string, "pull", "--ff-only"] },
        { command: "pnpm", argv: ["--dir", target as string, "install"] },
      ];
    default:
      // `df -h` and nothing else: no path, so there is nothing to aim and nothing to refuse.
      return [{ command: "df", argv: ["-h"] }];
  }
};

const traceFor = (input: {
  readonly role: Role;
  readonly capability: CapabilityName;
  readonly target: string | undefined;
  readonly steps: readonly CapabilityStep[];
  readonly changesState: boolean;
}): string =>
  [
    `capability ${input.capability}`,
    `role ${input.role.id}`,
    `target ${input.target ?? "(none)"}`,
    `${input.changesState ? "changes state" : "reads only"}`,
    `runs ${input.steps.map((s) => [s.command, ...s.argv].join(" ")).join(" && ")}`,
  ].join(" · ");

/**
 * THE RESOLUTION ITSELF — declaration first, call second, and no branch where a call that failed
 * one of the checks below ends up running a narrower version of what it asked for. There is no
 * fourth outcome for the same reason `resolveSpawnIdentity` has no fourth branch: a fall-through
 * that "did something reasonable" is how a closed list becomes a suggestion.
 */
export const resolveCapabilityCall = (input: {
  readonly role: Role;
  readonly call: CapabilityCall;
}): CapabilityResolution => {
  const { role, call } = input;
  const capability = (role.capabilities ?? []).find((c) => c.name === call.name);
  if (capability === undefined) {
    return { ok: false, refusal: capabilityNotDeclaredRefusal(role, call.name) };
  }

  const parameter = capabilityParameter(capability.name);
  if (parameter === undefined) {
    if (call.target !== undefined) {
      return {
        ok: false,
        refusal: capabilityTargetShapeRefusal({ role, capability, call, parameter }),
      };
    }
  } else {
    if (call.target === undefined) {
      return {
        ok: false,
        refusal: capabilityTargetShapeRefusal({ role, capability, call, parameter }),
      };
    }
    if (!closedListOf(capability).includes(call.target)) {
      return {
        ok: false,
        refusal: capabilityTargetNotDeclaredRefusal({
          role,
          capability,
          target: call.target,
          parameter,
        }),
      };
    }
  }

  if (capability.name === "log-tail") {
    if (call.lines !== undefined && call.lines > capability.maxLines) {
      return {
        ok: false,
        refusal: capabilityLinesRefusal({
          role,
          asked: call.lines,
          maxLines: capability.maxLines,
        }),
      };
    }
    if (call.lines !== undefined && (!Number.isInteger(call.lines) || call.lines < 1)) {
      return {
        ok: false,
        refusal: `role '${role.id}' asked 'log-tail' for '${call.lines}' lines: a tail is a whole number of lines and at least one. Repair: ask for a count between 1 and ${capability.maxLines}.`,
      };
    }
    // The target is a member of the declared list by the check above — so this refuses a CARD
    // this executor cannot serve, not a caller's mistake, and its repair is addressed to the card.
    if (!(call.target as string).startsWith("/")) {
      return {
        ok: false,
        refusal: capabilityTargetUnreadableRefusal({ role, target: call.target as string }),
      };
    }
  }

  const changesState = capability.name === "repo-refresh";
  const steps = stepsFor({ capability, target: call.target, lines: call.lines });
  return {
    ok: true,
    plan: {
      capability: capability.name,
      steps,
      changesState,
      trace: traceFor({
        role,
        capability: capability.name,
        target: call.target,
        steps,
        changesState,
      }),
    },
  };
};

/**
 * WHAT THIS BUILD STILL DOES NOT HAVE, said here rather than left to be discovered. The plan is
 * resolved and the refusals speak, but nothing RUNS a plan yet and nothing raises a call: there is
 * no surface. That surface is one decision this role may not take on its own — a command of the
 * CLI that performs a capability is a new entry in the permission vocabulary of
 * `agent-protocol.json` if it is gated like `thread-status`, and that file is a document of power.
 * So the executor's two halves are split at exactly the line where the second one needs john's
 * word, and the half that needs nobody's — the door, the commands, the trace — is here and tested.
 */
