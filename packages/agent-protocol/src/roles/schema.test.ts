import { describe, expect, it } from "vitest";

import { protocolConfigSchema } from "../config/config.js";

const MAIL = { branch: "comms", dir: "agent-comms" };

const human = {
  id: "john",
  kind: "человек",
  status: "active",
  wake: { mode: "self" },
  summary: "владелец",
};

describe("protocolConfigSchema", () => {
  it("принимает минимальный конфиг и по умолчанию не даёт роли никаких прав", () => {
    const parsed = protocolConfigSchema.parse({ version: 1, mail: MAIL, roles: [human] });

    expect(parsed.roles[0]?.permissions).toEqual([]);
  });

  it("отвергает неизвестное поле, а не проглатывает его", () => {
    // Опечатка в имени поля иначе означала бы молчаливое умолчание — тот самый
    // класс тихих дефектов, ради которого пакет и пишется.
    const result = protocolConfigSchema.safeParse({
      version: 1,
      mail: MAIL,
      roles: [{ ...human, sesion: "lle-john" }],
    });

    expect(result.success).toBe(false);
  });

  it("отвергает id, который не переживёт разбора в waiting-on", () => {
    const result = protocolConfigSchema.safeParse({
      version: 1,
      mail: MAIL,
      roles: [{ ...human, id: "Dev Core" }],
    });

    expect(result.success).toBe(false);
  });

  it("не даёт объявить сессию роли, которую никто не будит", () => {
    const result = protocolConfigSchema.safeParse({
      version: 1,
      mail: MAIL,
      roles: [{ ...human, wake: { mode: "self", session: "lle-john" } }],
    });

    expect(result.success).toBe(false);
  });

  it("требует session у роли на вахте и via у роли, оживающей через человека", () => {
    const noSession = protocolConfigSchema.safeParse({
      version: 1,
      mail: MAIL,
      roles: [{ ...human, id: "dev-core", wake: { mode: "watch" } }],
    });
    const noVia = protocolConfigSchema.safeParse({
      version: 1,
      mail: MAIL,
      roles: [{ ...human, id: "curator", wake: { mode: "via-human" } }],
    });

    expect(noSession.success).toBe(false);
    expect(noVia.success).toBe(false);
  });

  it("отвергает конфиг неизвестной версии формата", () => {
    const result = protocolConfigSchema.safeParse({ version: 2, mail: MAIL, roles: [human] });

    expect(result.success).toBe(false);
  });
});
