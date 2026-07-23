import { describe, expect, it } from "vitest";

import { loadRoleRegistry } from "./registry.js";
import { diffRolesDoc, parseRolesDocTable } from "./roles-doc.js";

const DOC = `# Реестр ролей

| id | тип | статус | зона / описание |
|---|---|---|---|
| john | человек | active | PM-владелец |
| curator | claude.ai | active | PM-ассистент |
| dev-speech | claude-code | **active** | произношение |

## Модель

Проза после таблицы разбором не считается.

| id | тип |
|---|---|
| призрак | из второй таблицы |
`;

const registry = loadRoleRegistry({
  version: 1,
  roles: [
    { id: "john", kind: "человек", status: "active", wake: { mode: "self" }, summary: "PM" },
    {
      id: "curator",
      kind: "claude.ai",
      status: "active",
      wake: { mode: "via-human", via: "john" },
      summary: "ассистент",
    },
    {
      id: "dev-speech",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "lle-dev-speech" },
      summary: "произношение",
    },
  ],
});

describe("parseRolesDocTable", () => {
  it("не считает ролью ячейку `id` из строки-заголовка", () => {
    // Регрессия треда 011: фильтр «строчные латинские» пропускал заголовок, и
    // в списке ролей молча заводился призрак. Роли берутся только ПОСЛЕ
    // разделителя таблицы.
    expect(parseRolesDocTable(DOC).map((row) => row.id)).toEqual(["john", "curator", "dev-speech"]);
  });

  it("снимает оформление со статуса", () => {
    const rows = parseRolesDocTable(DOC);

    expect(rows.find((row) => row.id === "dev-speech")?.status).toBe("active");
  });

  it("кончает разбор на прозе — вторая таблица ролей не объявляет", () => {
    expect(parseRolesDocTable(DOC).some((row) => row.id === "призрак")).toBe(false);
  });

  it("на документе без таблицы отдаёт пусто, а не падает", () => {
    expect(parseRolesDocTable("# Реестр\n\nтаблицы нет")).toEqual([]);
  });
});

describe("diffRolesDoc", () => {
  it("молчит, когда конфиг и документ описывают одно и то же", () => {
    expect(diffRolesDoc(registry, DOC)).toEqual([]);
  });

  it("видит роль, которой нет в документе", () => {
    const withGithub = loadRoleRegistry({
      version: 1,
      roles: [
        { id: "john", kind: "человек", status: "active", wake: { mode: "self" }, summary: "PM" },
        {
          id: "curator",
          kind: "claude.ai",
          status: "active",
          wake: { mode: "via-human", via: "john" },
          summary: "ассистент",
        },
        {
          id: "dev-speech",
          kind: "claude-code",
          status: "active",
          wake: { mode: "watch", session: "lle-dev-speech" },
          summary: "произношение",
        },
        {
          id: "github",
          kind: "gh-action",
          status: "active",
          wake: { mode: "event" },
          summary: "уведомитель",
        },
      ],
    });

    expect(diffRolesDoc(withGithub, DOC)).toEqual([
      {
        kind: "missing-in-doc",
        id: "github",
        message: "роль 'github' есть в конфиге, но её нет в таблице ROLES.md",
      },
    ]);
  });

  it("видит роль, которая есть в документе, но неизвестна контуру", () => {
    const doc = `${DOC}`.replace("| dev-speech |", "| dev-unknown |");
    const drift = diffRolesDoc(registry, doc);

    expect(drift.map((item) => item.kind).sort()).toEqual(["missing-in-config", "missing-in-doc"]);
  });

  it("видит расхождение типа и статуса", () => {
    const doc = DOC.replace("| curator | claude.ai | active |", "| curator | человек | paused |");
    const drift = diffRolesDoc(registry, doc);

    expect(drift).toHaveLength(2);
    expect(drift.every((item) => item.kind === "field-mismatch" && item.id === "curator")).toBe(
      true,
    );
  });
});
