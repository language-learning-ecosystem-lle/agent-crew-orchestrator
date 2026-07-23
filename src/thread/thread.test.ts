import { describe, expect, it } from "vitest";

import { renderIndex, threadsWaitingOn } from "./index-doc.js";
import { migrateLegacyThread, verifyMigration } from "./migrate.js";
import {
  declaredWaitingOn,
  parseLegacyThread,
  parseMetaFile,
  renderMetaFile,
  renderThread,
  updatedOf,
  waitingOnOf,
} from "./thread.js";

const ROLES = ["john", "curator", "dev-core", "dev-speech", "reviewer-pr", "github"];

// Слепок живого треда: две секции, объявление ожидания прозой со стрелкой,
// исторический хвост заголовка и проза со словом waiting-on БЕЗ стрелки.
const LEGACY = `# 012-agent-protocol-package · Вынос протокола в пакет

participants: curator, dev-core, john · status: open

## msg-001 · from: curator · 2026-07-23 · expects: answer · [СВЕРХПИСАНО msg-002]

Постановка. При непустом waiting-on генератор берёт последнее объявление.

waiting-on → dev-core.

## msg-002 · from: dev-core · 2026-07-23 · expects: none

Готово, PR открыт.

waiting-on → john (merge), curator (постановка).
`;

describe("parseLegacyThread", () => {
  it("разбирает шапку, секции и объявления ожидания", () => {
    const thread = parseLegacyThread("012-x", LEGACY, ROLES);

    expect(thread.meta).toEqual({
      title: "012-agent-protocol-package · Вынос протокола в пакет",
      participants: ["curator", "dev-core", "john"],
      status: "open",
    });
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0]?.fields.suffix).toBe("[СВЕРХПИСАНО msg-002]");
    expect(thread.messages[1]?.fields.waitingOn).toEqual(["john", "curator"]);
  });

  it("падает на нестандартной шапке, а не додумывает её", () => {
    expect(() => parseLegacyThread("012-x", "# только заголовок\n", ROLES)).toThrow(/шапка/);
  });
});

describe("declaredWaitingOn", () => {
  it("считает объявлением только стрелку сразу после слова", () => {
    expect(declaredWaitingOn("waiting-on остаётся на john", ROLES)).toBeUndefined();
    expect(declaredWaitingOn("waiting-on → john", ROLES)).toEqual(["john"]);
  });

  it("берёт последнее объявление, а не первое", () => {
    const text = "waiting-on → john\n\nпотом передумали\n\nwaiting-on → curator";

    expect(declaredWaitingOn(text, ROLES)).toEqual(["curator"]);
  });

  it("не теряет роль из-за пояснения в скобках", () => {
    // Тред 011: гипотезу «скобки съедают следующую роль» проверяли фактом.
    expect(declaredWaitingOn("waiting-on → dev-speech (этап 1), john (VPS)", ROLES)).toEqual([
      "dev-speech",
      "john",
    ]);
  });

  it("режет по последнему слову waiting-on, а не по первой стрелке в строке", () => {
    // Стрелка — ходовой символ прозы (@BotFather → chat_id → chmod 600).
    const text = "настройка: @BotFather → токен → chmod 600. waiting-on → john";

    expect(declaredWaitingOn(text, ROLES)).toEqual(["john"]);
  });

  it("объявление без известных ролей даёт пустой состав, а не отсутствие объявления", () => {
    expect(declaredWaitingOn("waiting-on → —", ROLES)).toEqual([]);
  });
});

describe("waitingOnOf", () => {
  it("берёт последнее ОБЪЯВЛЕНИЕ, даже если последняя секция ход не передавала", () => {
    const thread = parseLegacyThread("012-x", LEGACY, ROLES);
    const withNote = {
      ...thread,
      messages: [
        ...thread.messages,
        {
          fields: { msg: 3, from: "github", date: "2026-07-23", expects: "none" as const },
          text: "PR смёржен.",
        },
      ],
    };

    expect(waitingOnOf(withNote)).toEqual(["john", "curator"]);
  });

  it("у закрытого треда ожидания нет, что бы ни говорила последняя секция", () => {
    const thread = parseLegacyThread(
      "012-x",
      LEGACY.replace("status: open", "status: closed"),
      ROLES,
    );

    expect(waitingOnOf(thread)).toEqual([]);
  });
});

describe("renderThread / _meta.md", () => {
  it("сборка воспроизводит исходный тред байт-в-байт", () => {
    const thread = parseLegacyThread("012-x", LEGACY, ROLES);

    expect(renderThread(thread.meta, thread.messages)).toBe(LEGACY);
  });

  it("_meta.md разбирается и собирается обратно", () => {
    const thread = parseLegacyThread("012-x", LEGACY, ROLES);
    const raw = renderMetaFile(thread.meta);

    expect(parseMetaFile(raw)).toEqual(thread.meta);
  });
});

describe("renderIndex / threadsWaitingOn", () => {
  it("реестр собирается из тредов, закрытый показывает «—»", () => {
    const open = parseLegacyThread("012-x", LEGACY, ROLES);
    const closed = parseLegacyThread(
      "001-y",
      LEGACY.replace("status: open", "status: closed"),
      ROLES,
    );

    expect(renderIndex([closed, open])).toBe(
      `# Реестр разговоров

| id | participants | status | waiting-on | updated |
|---|---|---|---|---|
| 001-y | curator, dev-core, john | closed | — | 2026-07-23 |
| 012-x | curator, dev-core, john | open | john, curator | 2026-07-23 |
`,
    );
  });

  it("почта считается из тредов, а не из реестра", () => {
    // Если бы «есть ли почта» читалось из производного INDEX, падение его
    // генератора означало бы слепоту контура — боль 5 (тред 008).
    const thread = parseLegacyThread("012-x", LEGACY, ROLES);

    expect(threadsWaitingOn([thread], "john")).toEqual(["012-x"]);
    expect(threadsWaitingOn([thread], "dev-core")).toEqual([]);
  });

  it("updated — дата последнего сообщения", () => {
    expect(updatedOf(parseLegacyThread("012-x", LEGACY, ROLES))).toBe("2026-07-23");
  });
});

describe("migrateLegacyThread", () => {
  it("режет тред на файлы и воспроизводит исходник байт-в-байт", () => {
    const migration = migrateLegacyThread("012-x", LEGACY, ROLES);

    expect(migration.files.map((file) => file.path)).toEqual([
      "_meta.md",
      "messages/2026-07-23-001-curator.md",
      "messages/2026-07-23-002-dev-core.md",
      "_thread.md",
    ]);
    expect(verifyMigration(migration, LEGACY)).toBeUndefined();
  });

  it("сообщает о коллизии имён — иначе одно сообщение затёрло бы другое", () => {
    // Совпасть должны роль, дата и исторический номер разом. Побайтовый гард
    // такую пару НЕ ловит: он сверяет склейку из разобранных сообщений, а не
    // то, что осталось бы на диске после записи.
    const collided = LEGACY.replace(
      "## msg-002 · from: dev-core · 2026-07-23 · expects: none",
      "## msg-001 · from: curator · 2026-07-23 · expects: none",
    );
    const migration = migrateLegacyThread("012-x", collided, ROLES);

    expect(migration.collisions).toEqual([
      "два сообщения дают одно имя файла: messages/2026-07-23-001-curator.md",
    ]);
    expect(verifyMigration(migration, collided)).toBeUndefined();
  });

  it("на чистом треде коллизий нет", () => {
    expect(migrateLegacyThread("012-x", LEGACY, ROLES).collisions).toEqual([]);
  });

  it("гард показывает место расхождения, а не просто «не совпало»", () => {
    const migration = migrateLegacyThread("012-x", LEGACY, ROLES);
    const tampered = LEGACY.replace("Готово, PR открыт.", "Готово, PR открыт!");

    expect(verifyMigration(migration, tampered)).toMatch(/расхождение на байте \d+/);
  });
});
