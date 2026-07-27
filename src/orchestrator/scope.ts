/**
 * WHICH ROLES THIS DAEMON RAISES AT ALL (R13, thread `016-protocol-roadmap`) — the
 * scope of a run, resolved before anything is ordered or launched.
 *
 * Two filters live here, and they are deliberately in one module because they are the
 * same shape (a statement about ROLES, not about pairs) and they compose in a fixed
 * order:
 *
 *  1. **THE INSTANCE** — which box owns the role. Topology travels in the repository
 *     config (`instances`), the machine says which of them it is (`instance` in the
 *     machine config, R14). A role belongs to EXACTLY ONE instance, and that is
 *     load-bearing rather than decorative: leases are local to a machine, so a local
 *     lease only protects against a second session of the same role while no other box
 *     can raise it. Ownership is what MAKES the local lease sufficient — the overlap is
 *     gone by construction, not by agreement. Without it, two machines sharing one
 *     mail branch would raise one role twice and find out from a git conflict.
 *  2. **THE OPERATOR** — the scope of THIS run: all / listed (`--roles`) / all-but
 *     (`--exclude-roles`). It is the operator's, not the config's: "which agents does
 *     this launch raise" is a property of the launch, not of the machine or of the
 *     role (john's requirement, msg 18:55).
 *
 * THE DEFAULT IS ALL-MINE, not none. The safety of "nobody without being asked" is
 * already given by the enable gate — the daemon raises nobody until the circuit is
 * switched on by hand — and a second switch of the same meaning is the one that is
 * always forgotten: a watch that came up after a reboot without the flag would be a
 * daemon that is "on and not working", which is the failure mode this package spends
 * most of its words on. It is one constant (`DEFAULT_OPERATOR_SCOPE`) and one test if
 * john rules the other way.
 *
 * NOTHING DROPS OUT SILENTLY (norm #22): every role removed here comes back as an
 * exclusion with its reason and is spoken beside the queue, exactly like a skipped
 * candidate. A role missing from the queue for an unspoken reason is indistinguishable
 * from a role with no mail.
 *
 * WHAT IS NOT HERE: reaching another instance. Nothing in this module talks to another
 * box — ownership is read off two config files, and what the other machine is doing is
 * learned from what it PUBLISHES into the mail branch (the digest), never asked for.
 */
import type { Instance } from "../config/config.js";

/** Why a role is not raised by this run. */
export type ExclusionReason =
  /** The role is owned by another instance — that box raises it. */
  | "other-instance"
  /** The operator listed the roles of this run and this one is not among them. */
  | "not-listed"
  /** The operator excluded it by name. */
  | "excluded-by-operator";

export type RoleExclusion = {
  readonly role: string;
  readonly reason: ExclusionReason;
  /** The reason in words, ready for the daemon's stream: who owns it, who excluded it. */
  readonly detail: string;
};

/** How the operator stated the scope of this run — printed, so it is never guessed at. */
export type OperatorScope = "all" | "listed" | "all-but";

/** The default when the operator says nothing: every role this instance owns. */
export const DEFAULT_OPERATOR_SCOPE: OperatorScope = "all";

export type LaunchScope = {
  /** The roles this run may raise, in the order they were given. */
  readonly roles: readonly string[];
  /** Everything removed, with its reason. Never empty silently — the caller says each line. */
  readonly excluded: readonly RoleExclusion[];
  /** Which instance this box is, when the topology is declared at all. */
  readonly instance?: string;
  readonly operator: OperatorScope;
};

/** Who owns which role, from the topology section. Unowned roles simply are not in it. */
const ownerOf = (instances: readonly Instance[] | undefined): Map<string, string> => {
  const owners = new Map<string, string>();
  for (const instance of instances ?? []) {
    for (const role of instance.roles) {
      if (!owners.has(role)) owners.set(role, instance.id);
    }
  }
  return owners;
};

/**
 * THE OWNERSHIP CHECK, for `config check` — the door of the whole mechanism.
 *
 * A role with no owner and a role with two owners are both refused LOUDLY rather than
 * defaulted, and the asymmetry with the runtime is on purpose: at runtime a config that
 * has passed this check cannot produce either case, so the daemon needs no opinion
 * about them. The check runs on the config in a PR, where a human is looking.
 *
 * A repository that declares no instances is legitimate and produces no issues: that is
 * the pre-R13 behaviour verbatim (one box, every role), the same way an absent
 * `workdir.worktrees` means the pre-R17 behaviour. The package cannot invent a topology
 * for a project that has not described one.
 */
export const ownershipIssues = (input: {
  readonly instances?: readonly Instance[] | undefined;
  /** The roles the circuit is able to raise — the ones ownership has to answer for. */
  readonly launchable: readonly string[];
  /** Whether the id is a declared role at all — a typo in the topology is not a role. */
  readonly isKnownRole: (id: string) => boolean;
}): readonly string[] => {
  const instances = input.instances ?? [];
  if (instances.length === 0) return [];

  const issues: string[] = [];
  const seenInstances = new Set<string>();
  const claims = new Map<string, string[]>();
  for (const instance of instances) {
    if (seenInstances.has(instance.id)) {
      issues.push(
        `instance '${instance.id}' is declared twice — two descriptions of one box drift apart, and which one wins depends on the order in the file`,
      );
    }
    seenInstances.add(instance.id);
    for (const role of instance.roles) {
      if (!input.isKnownRole(role)) {
        issues.push(
          `instance '${instance.id}' claims role '${role}', which is not declared in 'roles'`,
        );
      }
      claims.set(role, [...(claims.get(role) ?? []), instance.id]);
    }
  }

  for (const [role, owners] of claims) {
    if (owners.length > 1) {
      issues.push(
        `role '${role}' is claimed by ${owners.map((id) => `'${id}'`).join(" and ")} — a role belongs to EXACTLY ONE instance, otherwise two boxes raise it at once and the local leases protect neither`,
      );
    }
  }
  for (const role of input.launchable) {
    if (!claims.has(role)) {
      issues.push(
        `role '${role}' can be launched but no instance claims it — declare which box raises it, or nobody will (the daemon skips roles of other instances, and an unowned role is nobody's)`,
      );
    }
  }
  return issues;
};

/**
 * WHETHER THIS BOX KNOWS WHO IT IS. The topology is only half of the join (R14): the
 * repository says which instances exist, the machine says which one it is, and neither
 * file mentions the other. A missing or unknown half is refused rather than guessed:
 * a daemon that does not know its own name would have to treat "is this my role" as a
 * guess, and the answer it would guess is the one that raises somebody else's role.
 */
export const instanceIssues = (input: {
  readonly instances?: readonly Instance[] | undefined;
  readonly instance?: string;
  /** Where the machine config is, so the repair is a path and not a search. */
  readonly localConfigPath: string;
}): readonly string[] => {
  const declared = (input.instances ?? []).map((instance) => instance.id);
  if (declared.length === 0) {
    if (input.instance === undefined) return [];
    return [
      `the machine calls itself instance '${input.instance}' ('${input.localConfigPath}'), but the repository config declares no instances — the name has nothing to join to`,
    ];
  }
  if (input.instance === undefined) {
    return [
      `this box does not know which instance it is: the repository declares ${declared.map((id) => `'${id}'`).join(", ")}, and the machine config '${input.localConfigPath}' says nothing — add "instance": "<id>" (the repository says WHAT exists, the machine says WHO it is)`,
    ];
  }
  if (!declared.includes(input.instance)) {
    return [
      `the machine calls itself instance '${input.instance}' ('${input.localConfigPath}'), which the repository does not declare — it knows ${declared.map((id) => `'${id}'`).join(", ")}`,
    ];
  }
  return [];
};

/** A refusal of the operator's flags, at the door — before a single tick. */
export const scopeFlagIssues = (input: {
  readonly select?: readonly string[];
  readonly exclude?: readonly string[];
  /** Every role the circuit could raise — a name outside it is a typo, not a scope. */
  readonly launchable: readonly string[];
}): readonly string[] => {
  const issues: string[] = [];
  if (input.select !== undefined && input.exclude !== undefined) {
    issues.push(
      "--roles and --exclude-roles are mutually exclusive: name the roles of this run, or name the ones it leaves out — both at once has two answers",
    );
  }
  // A NAME THAT MATCHES NOTHING IS A REFUSAL, not an empty filter: `--roles dev-cor`
  // would otherwise be a daemon that raises nobody and says it is working as asked.
  for (const name of [...(input.select ?? []), ...(input.exclude ?? [])]) {
    if (!input.launchable.includes(name)) {
      issues.push(
        `role '${name}' is not a launchable role of this circuit (${input.launchable.join(", ") || "none"})`,
      );
    }
  }
  return issues;
};

/**
 * The scope of this run: the launchable roles minus the other instances' minus whatever
 * the operator left out — with every removal named.
 *
 * The order of the two filters matters and is fixed: the instance first, because it is
 * structural (the role is not this box's to raise at all), the operator second, because
 * it narrows what is already ours. A role owned elsewhere AND excluded by the operator
 * is reported as the former — the reason a human needs to hear is the one they cannot
 * change with a flag.
 */
export const resolveLaunchScope = (input: {
  readonly launchable: readonly string[];
  readonly instances?: readonly Instance[] | undefined;
  readonly instance?: string;
  readonly select?: readonly string[];
  readonly exclude?: readonly string[];
}): LaunchScope => {
  const owners = ownerOf(input.instances);
  const operator: OperatorScope =
    input.select !== undefined ? "listed" : input.exclude !== undefined ? "all-but" : "all";

  const roles: string[] = [];
  const excluded: RoleExclusion[] = [];
  for (const role of input.launchable) {
    const owner = owners.get(role);
    if (owner !== undefined && input.instance !== undefined && owner !== input.instance) {
      excluded.push({
        role,
        reason: "other-instance",
        detail: `owned by instance '${owner}', this box is '${input.instance}'`,
      });
      continue;
    }
    if (input.select !== undefined && !input.select.includes(role)) {
      excluded.push({
        role,
        reason: "not-listed",
        detail: `outside the scope of this run (--roles ${input.select.join(",")})`,
      });
      continue;
    }
    if (input.exclude?.includes(role) === true) {
      excluded.push({
        role,
        reason: "excluded-by-operator",
        detail: `excluded by the operator (--exclude-roles ${input.exclude.join(",")})`,
      });
      continue;
    }
    roles.push(role);
  }
  return {
    roles,
    excluded,
    ...(input.instance === undefined ? {} : { instance: input.instance }),
    operator,
  };
};

/** One line per excluded role, for the daemon's stream — beside the queue it is missing from. */
export const describeExclusion = (exclusion: RoleExclusion): string =>
  `role ${exclusion.role} is not raised by this run: ${exclusion.detail}`;

/** The scope in one line, for the banner and for `status`: what would be raised, and by whom. */
export const describeScope = (scope: LaunchScope): string => {
  const where =
    scope.instance === undefined ? "no instance declared" : `instance ${scope.instance}`;
  const what =
    scope.operator === "all"
      ? "every role of this instance"
      : scope.operator === "listed"
        ? "the roles named by the operator"
        : "every role of this instance except the ones excluded";
  return `scope: ${where}, ${what} — ${scope.roles.join(", ") || "NONE"}${
    scope.excluded.length === 0
      ? ""
      : ` (${scope.excluded.length} left out, see the lines beside the queue)`
  }`;
};
