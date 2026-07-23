import { describe, expect, it } from "vitest";

import { parseProtocolConfig } from "../config/config.js";
import { createRoleRegistry, RoleConfigError } from "./registry.js";

const john = {
  id: "john",
  kind: "человек",
  status: "active",
  wake: { mode: "self" },
  summary: "PM-владелец",
  permissions: ["thread-status"],
};

const curator = {
  id: "curator",
  kind: "claude.ai",
  status: "active",
  wake: { mode: "via-human", via: "john" },
  summary: "PM-ассистент",
  permissions: ["thread-status"],
};

const devCore = {
  id: "dev-core",
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: "lle-dev-core" },
  summary: "основной поток",
};

const reviewer = {
  id: "reviewer-pr",
  kind: "gh-action",
  status: "active",
  wake: { mode: "event" },
  summary: "ревью PR",
};

const MAIL = { branch: "comms", dir: "agent-comms" };

const registryOf = (...roles: unknown[]) =>
  createRoleRegistry(parseProtocolConfig({ version: 1, mail: MAIL, roles }));

describe("loadRoleRegistry", () => {
  it("ловит дубль роли", () => {
    expect(() => registryOf(john, { ...john, summary: "он же, но другой" })).toThrow(
      /объявлена дважды/,
    );
  });

  it("ловит обрыв цепочки пробуждения: via ведёт в несуществующую роль", () => {
    expect(() => registryOf({ ...curator, wake: { mode: "via-human", via: "jonh" } })).toThrow(
      /цепочка пробуждения обрывается/,
    );
  });

  it("ловит via на роль, которую саму некому разбудить", () => {
    // Уведомление ушло бы тому, кто его не увидит: «дёрни того, кого тоже
    // никто не дёргает» — тишина, неотличимая от штатной работы.
    expect(() =>
      registryOf(devCore, { ...curator, wake: { mode: "via-human", via: "dev-core" } }),
    ).toThrow(/некому разбудить/);
  });

  it("ловит две роли на одной сессии", () => {
    const devSpeech = { ...devCore, id: "dev-speech" };

    expect(() => registryOf(devCore, devSpeech)).toThrow(/делят сессию/);
  });

  it("перечисляет ВСЕ претензии сразу, а не первую встреченную", () => {
    try {
      registryOf(john, john, { ...curator, wake: { mode: "via-human", via: "no-such-role" } });
      expect.unreachable("конфиг обязан быть отвергнут");
    } catch (error) {
      expect(error).toBeInstanceOf(RoleConfigError);
      expect((error as RoleConfigError).issues).toHaveLength(2);
    }
  });
});

describe("RoleRegistry", () => {
  it("знает все объявленные роли, включая ушедшие: старые треды на них ссылаются", () => {
    const retired = { ...devCore, id: "dev-legacy", status: "retired", wake: { mode: "event" } };
    const registry = registryOf(john, devCore, retired);

    expect(registry.ids()).toEqual(["john", "dev-core", "dev-legacy"]);
    expect(registry.isKnown("dev-legacy")).toBe(true);
    expect(registry.active().map((role) => role.id)).toEqual(["john", "dev-core"]);
  });

  it("права на статус треда есть только у тех, кому они выданы", () => {
    const registry = registryOf(john, curator, devCore);

    expect(registry.canEditThreadStatus("john")).toBe(true);
    expect(registry.canEditThreadStatus("curator")).toBe(true);
    expect(registry.canEditThreadStatus("dev-core")).toBe(false);
    expect(registry.canEditThreadStatus("никто")).toBe(false);
  });

  it("сторожу отдаёт только роли с сессией, и только активные", () => {
    const paused = {
      ...devCore,
      id: "dev-speech",
      status: "paused",
      wake: { mode: "watch", session: "lle-dev-speech" },
    };
    const registry = registryOf(john, curator, devCore, paused, reviewer);

    expect(registry.watchTargets()).toEqual([{ id: "dev-core", session: "lle-dev-core" }]);
  });

  it("уведомителю отдаёт человека напрямую, ассистента — через человека, а агентов не отдаёт вовсе", () => {
    // Различие формулировок (тред 008) перестаёт быть знанием внутри awk и
    // становится следствием данных: у dev-роли есть сторож, у curator нет.
    const registry = registryOf(john, curator, devCore, reviewer);

    expect(registry.notificationTargets()).toEqual([
      { id: "john", style: "direct" },
      { id: "curator", style: "nudge", nudge: "john" },
    ]);
  });
});
