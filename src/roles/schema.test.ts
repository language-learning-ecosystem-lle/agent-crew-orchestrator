import { describe, expect, it } from "vitest";

import { roleRegistryConfigSchema } from "./schema.js";

const human = {
  id: "john",
  kind: "человек",
  status: "active",
  wake: { mode: "self" },
  summary: "владелец",
};

describe("roleRegistryConfigSchema", () => {
  it("принимает минимальный конфиг и по умолчанию не даёт роли никаких прав", () => {
    const parsed = roleRegistryConfigSchema.parse({ version: 1, roles: [human] });

    expect(parsed.roles[0]?.permissions).toEqual([]);
  });

  it("отвергает неизвестное поле, а не проглатывает его", () => {
    // Опечатка в имени поля иначе означала бы молчаливое умолчание — тот самый
    // класс тихих дефектов, ради которого пакет и пишется.
    const result = roleRegistryConfigSchema.safeParse({
      version: 1,
      roles: [{ ...human, sesion: "lle-john" }],
    });

    expect(result.success).toBe(false);
  });

  it("отвергает id, который не переживёт разбора в waiting-on", () => {
    const result = roleRegistryConfigSchema.safeParse({
      version: 1,
      roles: [{ ...human, id: "Dev Core" }],
    });

    expect(result.success).toBe(false);
  });

  it("не даёт объявить сессию роли, которую никто не будит", () => {
    const result = roleRegistryConfigSchema.safeParse({
      version: 1,
      roles: [{ ...human, wake: { mode: "self", session: "lle-john" } }],
    });

    expect(result.success).toBe(false);
  });

  it("требует session у роли на вахте и via у роли, оживающей через человека", () => {
    const noSession = roleRegistryConfigSchema.safeParse({
      version: 1,
      roles: [{ ...human, id: "dev-core", wake: { mode: "watch" } }],
    });
    const noVia = roleRegistryConfigSchema.safeParse({
      version: 1,
      roles: [{ ...human, id: "curator", wake: { mode: "via-human" } }],
    });

    expect(noSession.success).toBe(false);
    expect(noVia.success).toBe(false);
  });

  it("отвергает конфиг неизвестной версии формата", () => {
    const result = roleRegistryConfigSchema.safeParse({ version: 2, roles: [human] });

    expect(result.success).toBe(false);
  });
});
