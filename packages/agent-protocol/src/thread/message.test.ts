import { describe, expect, it } from "vitest";

import { messageFileName, parseMessageFile, renderHeading, renderMessageFile } from "./message.js";

const FILE = `---
from: dev-core
date: 2026-07-23T13:45:12Z
expects: answer
waiting-on: john, curator
---

Текст сообщения.

waiting-on объявлен полем, а не прозой.
`;

describe("parseMessageFile", () => {
  it("разбирает заголовок и тело", () => {
    const message = parseMessageFile(FILE);

    expect(message.fields).toEqual({
      from: "dev-core",
      date: "2026-07-23T13:45:12Z",
      expects: "answer",
      waitingOn: ["john", "curator"],
    });
    expect(message.text.startsWith("Текст сообщения.")).toBe(true);
  });

  it("различает «поля нет» и «ожидание снято»", () => {
    // Три состояния (решение john): нет поля — ход не передаю, ожидание
    // наследуется; «—» — ожидание снято; список — полный остаточный состав.
    const noField = parseMessageFile(FILE.replace("waiting-on: john, curator\n", ""));
    const cleared = parseMessageFile(FILE.replace("waiting-on: john, curator", "waiting-on: —"));

    expect(noField.fields.waitingOn).toBeUndefined();
    expect(cleared.fields.waitingOn).toEqual([]);
  });

  it("отвергает файл без заголовка, без обязательных полей и с чужим expects", () => {
    expect(() => parseMessageFile("просто текст")).toThrow(/'---'/);
    expect(() => parseMessageFile("---\nfrom: dev-core\n---\n\nтекст\n")).toThrow(/обязательны/);
    expect(() => parseMessageFile(FILE.replace("expects: answer", "expects: maybe"))).toThrow(
      /expects/,
    );
  });

  it("отвергает метку времени не в UTC-форме", () => {
    expect(() =>
      parseMessageFile(FILE.replace("2026-07-23T13:45:12Z", "23.07.2026 13:45")),
    ).toThrow(/метка UTC/);
  });

  it("склейка разбор→сборка не меняет файл", () => {
    expect(renderMessageFile(parseMessageFile(FILE))).toBe(FILE);
  });
});

describe("messageFileName", () => {
  it("новое сообщение — метка времени и роль", () => {
    expect(
      messageFileName({ from: "curator", date: "2026-07-23T13:45:12Z", expects: "answer" }),
    ).toBe("2026-07-23T13-45-12Z-curator.md");
  });

  it("мигрированное — дата, позиция, роль; и сортируется раньше нового в тот же день", () => {
    const migrated = messageFileName({
      msg: 3,
      from: "curator",
      date: "2026-07-23",
      expects: "answer",
    });
    const fresh = messageFileName({
      from: "curator",
      date: "2026-07-23T13:45:12Z",
      expects: "answer",
    });

    expect(migrated).toBe("2026-07-23-003-curator.md");
    expect([fresh, migrated].sort()).toEqual([migrated, fresh]);
  });
});

describe("renderHeading", () => {
  it("у мигрированного печатает исторический номер, у нового — позицию", () => {
    const legacy = renderHeading(
      { msg: 5, from: "curator", date: "2026-07-21", expects: "none" },
      99,
    );
    const fresh = renderHeading(
      { from: "dev-core", date: "2026-07-23T13:45:12Z", expects: "answer" },
      7,
    );

    expect(legacy).toBe("## msg-005 · from: curator · 2026-07-21 · expects: none");
    expect(fresh).toBe("## msg-007 · from: dev-core · 2026-07-23 · expects: answer");
  });

  it("сохраняет исторический хвост заголовка", () => {
    const heading = renderHeading(
      {
        msg: 1,
        from: "curator",
        date: "2026-07-22",
        expects: "none",
        suffix: "[СВЕРХПИСАНО msg-002]",
      },
      1,
    );

    expect(heading).toBe(
      "## msg-001 · from: curator · 2026-07-22 · expects: none · [СВЕРХПИСАНО msg-002]",
    );
  });
});
