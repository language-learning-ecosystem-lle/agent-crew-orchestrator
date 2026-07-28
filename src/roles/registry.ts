/**
 * The role registry: loading the config and the queries the circuit lives on.
 *
 * The package does not keep the list of roles inside itself — it takes the
 * project's config from outside. The reason is the same one for which the index
 * generator reads `ROLES.md` instead of a baked-in list: activate a new role and
 * the circuit learns about it by itself.
 *
 * CONSISTENCY CHECKS that a field-by-field schema cannot give, each about a real
 * failure rather than about tidiness:
 *
 * - **duplicate id** — two descriptions of one role drift apart, and which one
 *   wins depends on the order in the file;
 * - **`via` points nowhere, or to a role nobody can wake either** — the wake
 *   chain breaks silently: the notification goes to someone who will not see it;
 * - **two roles sharing one tmux session** — the watch-keeper wakes by session
 *   name, so `/wake` would drive into a foreign session: one role would get
 *   another's mail, the second would not get its own.
 *
 * A load error is an exception with the full list of complaints, not the first
 * one encountered: the config is edited by a human, and "fix this, then you will
 * learn about the next one" is a bad loop.
 */
import type { Permission, Role, RoleId } from "./schema.js";

/** All the registry needs from the config: it does not know what other sections are there. */
export type RolesSection = { readonly roles: readonly Role[] };

/** Whom to notify about the turn passing, and in which form. The text is not our business: it is the project's. */
export type NotificationTarget =
  | { readonly id: RoleId; readonly style: "direct" }
  | { readonly id: RoleId; readonly style: "nudge"; readonly nudge: RoleId };

/** Whom the watch-keeper wakes and in which session. */
export type WatchTarget = { readonly id: RoleId; readonly session: string };

export type RoleRegistry = {
  /** All declared roles, retired included: old threads reference them, and parsing must not lose them. */
  ids(): readonly RoleId[];
  get(id: RoleId): Role | undefined;
  isKnown(id: RoleId): boolean;
  active(): readonly Role[];
  canEditThreadStatus(id: RoleId): boolean;
  /** Whether the role's launch directives in a feed take effect (R21, `launch-params`). */
  canSetLaunchParams(id: RoleId): boolean;
  /** Whether the role's thread priorities in a feed take effect (R5, `thread-priority`). */
  canSetThreadPriority(id: RoleId): boolean;
  /**
   * Whether the role may HOLD THE TURN — be the value of `waiting-on` (R24). Every role
   * of the circuit may; a role that wakes itself (`wake.mode: 'self'` — a human) may not.
   *
   * IT IS DERIVED FROM `wake`, NOT DECLARED SEPARATELY, and that is the point: the turn
   * exists to be acted upon, and the circuit's only means of making that happen is
   * waking somebody. A role there is nobody to wake cannot be moved by the feed, so a
   * wait on it is not a turn but an open question — carried by whoever asks it.
   */
  canHoldTurn(id: RoleId): boolean;
  watchTargets(): readonly WatchTarget[];
  notificationTargets(): readonly NotificationTarget[];
  /**
   * The roles hosted by a process that is already alive (R23-1). Neither woken nor
   * raised nor notified — but ownership answers for them (R13) and a thread waiting on
   * one has to be VISIBLE, so the list is a query rather than a filter each caller
   * writes for itself.
   */
  residents(): readonly RoleId[];
};

export class RoleConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`role config is invalid:\n- ${issues.join("\n- ")}`);
    this.name = "RoleConfigError";
    this.issues = issues;
  }
}

const hasPermission = (role: Role, permission: Permission): boolean =>
  role.permissions.includes(permission);

/** Checks that a single-field schema cannot express. */
const crossCheck = (config: RolesSection): string[] => {
  const issues: string[] = [];
  const byId = new Map<RoleId, Role>();

  for (const role of config.roles) {
    if (byId.has(role.id)) {
      issues.push(`role '${role.id}' is declared twice`);
      continue;
    }
    byId.set(role.id, role);
  }

  const sessions = new Map<string, RoleId>();
  for (const role of byId.values()) {
    if (role.wake.mode === "via-human") {
      const via = byId.get(role.wake.via);
      if (!via) {
        issues.push(
          `role '${role.id}' comes alive via '${role.wake.via}', but there is no such role — the wake chain breaks`,
        );
      } else if (via.wake.mode !== "self") {
        issues.push(
          `role '${role.id}' comes alive via '${via.id}', and there is nobody to wake that one either (wake.mode='${via.wake.mode}', 'self' required)`,
        );
      }
    }

    if (role.wake.mode === "watch") {
      const taken = sessions.get(role.wake.session);
      if (taken) {
        issues.push(
          `roles '${taken}' and '${role.id}' share session '${role.wake.session}' — the wake-up would go to the wrong place`,
        );
      } else {
        sessions.set(role.wake.session, role.id);
      }
    }
  }

  return issues;
};

export const createRoleRegistry = (config: RolesSection): RoleRegistry => {
  const issues = crossCheck(config);
  if (issues.length > 0) throw new RoleConfigError(issues);

  const byId = new Map<RoleId, Role>(config.roles.map((role) => [role.id, role]));
  const active = config.roles.filter((role) => role.status === "active");

  return {
    ids: () => config.roles.map((role) => role.id),
    get: (id) => byId.get(id),
    isKnown: (id) => byId.has(id),
    active: () => active,
    canEditThreadStatus: (id) => {
      const role = byId.get(id);
      return role !== undefined && hasPermission(role, "thread-status");
    },
    canSetLaunchParams: (id) => {
      const role = byId.get(id);
      return role !== undefined && hasPermission(role, "launch-params");
    },
    canSetThreadPriority: (id) => {
      const role = byId.get(id);
      return role !== undefined && hasPermission(role, "thread-priority");
    },
    canHoldTurn: (id) => {
      const role = byId.get(id);
      return role !== undefined && role.wake.mode !== "self";
    },
    watchTargets: () =>
      active.flatMap((role) =>
        role.wake.mode === "watch" ? [{ id: role.id, session: role.wake.session }] : [],
      ),
    // A RESIDENT IS NOT A NOTIFICATION TARGET, and that is not an omission: the
    // notifier exists to tell somebody who is not looking that the turn has passed,
    // and a resident is the one participant who is looking by definition. It reads the
    // turn out of the feed like any other reader of the mail.
    notificationTargets: () =>
      active.flatMap((role): NotificationTarget[] => {
        if (role.wake.mode === "self") return [{ id: role.id, style: "direct" }];
        if (role.wake.mode === "via-human")
          return [{ id: role.id, style: "nudge", nudge: role.wake.via }];
        return [];
      }),
    residents: () => active.flatMap((role) => (role.wake.mode === "resident" ? [role.id] : [])),
  };
};
