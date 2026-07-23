import { describe, expect, it } from "vitest";

import { parseProtocolConfig } from "../config/config.js";
import { createRoleRegistry } from "../roles/registry.js";
import { checkImmutable, checkThread, type ThreadInput } from "./check.js";
import type { Message } from "./message.js";
import { renderThread, type ThreadMeta } from "./thread.js";

const registry = createRoleRegistry(
  parseProtocolConfig({
    version: 1,
    mail: { branch: "comms", dir: "agent-comms" },
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
        id: "dev-core",
        kind: "claude-code",
        status: "active",
        wake: { mode: "watch", session: "lle-dev-core" },
        summary: "поток",
      },
    ],
  }),
);

const meta: ThreadMeta = {
  title: "012-x · тред",
  participants: ["curator", "dev-core", "john"],
  status: "open",
};

const message = (over: Partial<Message["fields"]> = {}, text = "Текст."): Message => ({
  fields: {
    from: "dev-core",
    date: "2026-07-23T13:45:12Z",
    expects: "answer",
    waitingOn: ["curator"],
    ...over,
  },
  text,
});

const input = (over: Partial<ThreadInput> = {}): ThreadInput => {
  const entries = over.entries ?? [
    { fileName: "2026-07-23T13-45-12Z-dev-core.md", message: message() },
  ];
  return { id: "012-x", meta, ...over, entries };
};

describe("checkThread", () => {
  it("молчит на корректном треде", () => {
    const entries = input().entries;
    const doc = renderThread(
      meta,
      entries.map((entry) => entry.message),
    );

    expect(checkThread(input({ threadDoc: doc }), registry)).toEqual([]);
  });

  it("красит неизвестную роль в from и в waiting-on, а не отбрасывает её молча", () => {
    // Молчаливый отброс и был механизмом потери роли из объявления (боль 2):
    // опечатка давала пустое ожидание и тишину, неотличимую от штатной работы.
    const issues = checkThread(
      input({
        entries: [
          {
            fileName: "2026-07-23T13-45-12Z-github.md",
            message: message({ from: "github", waitingOn: ["jonh"] }),
          },
        ],
      }),
      registry,
    );

    expect(issues.map((issue) => issue.message)).toEqual([
      "'from: github' — такой роли нет в конфиге",
      "в 'waiting-on' роль 'jonh', которой нет в конфиге",
    ]);
  });

  it("ловит имя файла, разошедшееся с заголовком", () => {
    const issues = checkThread(
      input({ entries: [{ fileName: "сообщение.md", message: message() }] }),
      registry,
    );

    expect(issues[0]?.message).toMatch(/ожидалось '2026-07-23T13-45-12Z-dev-core.md'/);
  });

  it("ловит строку «## msg-» в теле — об неё развалилась бы склейка", () => {
    const issues = checkThread(
      input({
        entries: [
          {
            fileName: "2026-07-23T13-45-12Z-dev-core.md",
            message: message(
              {},
              "Цитирую:\n\n## msg-001 · from: curator · 2026-07-22 · expects: none",
            ),
          },
        ],
      }),
      registry,
    );

    expect(issues[0]?.message).toMatch(/склейка треда развалится/);
  });

  it("ловит производный файл, разошедшийся с сообщениями", () => {
    const issues = checkThread(input({ threadDoc: "# что-то своё\n" }), registry);

    expect(issues[0]?.message).toMatch(/производный файл разошёлся/);
  });

  it("ловит участника, которого нет в конфиге ролей", () => {
    const issues = checkThread(
      input({ meta: { ...meta, participants: ["curator", "нет-роли"] } }),
      registry,
    );

    expect(issues[0]?.message).toMatch(/не значится ролью/);
  });
});

describe("checkImmutable", () => {
  it("красит правку и удаление ранее закоммиченного сообщения", () => {
    const before = new Map([
      ["012-x/messages/a.md", "было"],
      ["012-x/messages/b.md", "цело"],
    ]);
    const after = new Map([
      ["012-x/messages/a.md", "стало"],
      ["012-x/messages/c.md", "новое"],
    ]);

    expect(checkImmutable(before, after).map((issue) => issue.message)).toEqual([
      "файл сообщения изменён после коммита — правка задним числом",
      "файл сообщения удалён — лента append-only",
    ]);
  });

  it("новые файлы правкой не считает — лента растёт", () => {
    const before = new Map([["012-x/messages/a.md", "было"]]);
    const after = new Map([
      ["012-x/messages/a.md", "было"],
      ["012-x/messages/b.md", "новое"],
    ]);

    expect(checkImmutable(before, after)).toEqual([]);
  });
});
