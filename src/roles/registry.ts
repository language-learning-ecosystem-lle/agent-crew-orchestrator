/**
 * Реестр ролей: загрузка конфига и запросы, из которых живёт контур.
 *
 * Пакет не хранит список ролей внутри себя — он принимает конфиг проекта
 * снаружи. Причина та же, по которой генератор реестра читает `ROLES.md`, а не
 * зашитый список: активировали новую роль — контур узнаёт о ней сам.
 *
 * ПРОВЕРКИ СВЯЗНОСТИ, которых не даёт схема поля-за-полем, и каждая — про
 * реальный отказ, а не про аккуратность:
 *
 * - **дубль id** — два описания одной роли расходятся, и какое победит,
 *   зависит от порядка в файле;
 * - **`via` ведёт в никуда или в роль, которую саму некому разбудить** — цепочка
 *   пробуждения обрывается молча: уведомление уходит тому, кто его не увидит;
 * - **общая tmux-сессия у двух ролей** — сторож будит по имени сессии, и
 *   `/wake` уехал бы в чужую сессию: одна роль получала бы чужую почту, вторая
 *   не получала бы своей.
 *
 * Ошибка загрузки — исключение с полным перечнем претензий, а не первая
 * встреченная: конфиг правит человек, и «почини это, потом узнаешь про
 * следующее» — плохой цикл.
 */
import type { Permission, Role, RoleId } from "./schema.js";

/** Всё, что реестру нужно от конфига: он не знает, какие ещё секции там есть. */
export type RolesSection = { readonly roles: readonly Role[] };

/** Кого уведомлять о переходе хода и в какой форме. Текст — не наше дело: он проектный. */
export type NotificationTarget =
  | { readonly id: RoleId; readonly style: "direct" }
  | { readonly id: RoleId; readonly style: "nudge"; readonly nudge: RoleId };

/** Кого будит сторож и в какой сессии. */
export type WatchTarget = { readonly id: RoleId; readonly session: string };

export type RoleRegistry = {
  /** Все объявленные роли, включая retired: старые треды ссылаются на них, и разбор не должен их терять. */
  ids(): readonly RoleId[];
  get(id: RoleId): Role | undefined;
  isKnown(id: RoleId): boolean;
  active(): readonly Role[];
  canEditThreadStatus(id: RoleId): boolean;
  watchTargets(): readonly WatchTarget[];
  notificationTargets(): readonly NotificationTarget[];
};

export class RoleConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`конфиг ролей невалиден:\n- ${issues.join("\n- ")}`);
    this.name = "RoleConfigError";
    this.issues = issues;
  }
}

const hasPermission = (role: Role, permission: Permission): boolean =>
  role.permissions.includes(permission);

/** Проверки, которые не выражаются схемой одного поля. */
const crossCheck = (config: RolesSection): string[] => {
  const issues: string[] = [];
  const byId = new Map<RoleId, Role>();

  for (const role of config.roles) {
    if (byId.has(role.id)) {
      issues.push(`роль '${role.id}' объявлена дважды`);
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
          `роль '${role.id}' оживает через '${role.wake.via}', но такой роли нет — цепочка пробуждения обрывается`,
        );
      } else if (via.wake.mode !== "self") {
        issues.push(
          `роль '${role.id}' оживает через '${via.id}', а того самого некому разбудить (wake.mode='${via.wake.mode}', нужен 'self')`,
        );
      }
    }

    if (role.wake.mode === "watch") {
      const taken = sessions.get(role.wake.session);
      if (taken) {
        issues.push(
          `роли '${taken}' и '${role.id}' делят сессию '${role.wake.session}' — пробуждение уехало бы не туда`,
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
    watchTargets: () =>
      active.flatMap((role) =>
        role.wake.mode === "watch" ? [{ id: role.id, session: role.wake.session }] : [],
      ),
    notificationTargets: () =>
      active.flatMap((role): NotificationTarget[] => {
        if (role.wake.mode === "self") return [{ id: role.id, style: "direct" }];
        if (role.wake.mode === "via-human")
          return [{ id: role.id, style: "nudge", nudge: role.wake.via }];
        return [];
      }),
  };
};
