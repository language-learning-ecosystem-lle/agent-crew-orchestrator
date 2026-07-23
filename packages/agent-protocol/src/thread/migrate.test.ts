import { describe, expect, it } from "vitest";

import type { Message } from "./message.js";
import { migrateLegacyThread, verifyMigration } from "./migrate.js";
import { renderThread, type ThreadMeta } from "./thread.js";

// Регрессия 012 (msg-069). Уведомитель о merge #27 стамповал сообщение датой
// 2026-07-23, а дописал его в ленту ПОСЛЕ сообщений 2026-07-24 (job стартовал до
// полуночи UTC, retry-цикл допушил после). Дата немонотонна порядку треда.
// Имя мигрированного файла ведёт датой — плоская сортировка имён поставила бы
// github(002) первым и переставила ленту. Порядок держит `seq` (позиция), и
// миграция обязана ПРИНИМАТЬСЯ, а не падать round-trip'ом сортировки.
const roles = ["curator", "github"];

const meta: ThreadMeta = {
  title: "012-x · тред",
  participants: ["curator", "github"],
  status: "open",
};

// Строим оригинал рендером — формат гарантирован тем же кодом, что читает миграция.
const messages: Message[] = [
  {
    fields: { msg: 1, from: "curator", date: "2026-07-24", expects: "answer" },
    text: "Первое, дата 24-го.",
  },
  {
    fields: { msg: 2, from: "github", date: "2026-07-23", expects: "none" },
    text: "Позже по ленте, дата 23-я.",
  },
];
const original = renderThread(meta, messages);

describe("migrateLegacyThread + verifyMigration (немонотонная дата)", () => {
  it("плоская сортировка имён переставила бы ленту — потому имя НЕ ключ порядка", () => {
    const migration = migrateLegacyThread("012-x", original, roles);
    const names = migration.files
      .filter((f) => f.path.startsWith("messages/"))
      .map((f) => f.path)
      .sort();

    // github(002) с датой 07-23 сортируется ИМЕНЕМ раньше curator(001) 07-24:
    expect(names[0]).toContain("002-github");
  });

  it("гард принимает миграцию: порядок по seq воспроизводит оригинал байт-в-байт", () => {
    const migration = migrateLegacyThread("012-x", original, roles);
    expect(verifyMigration(migration, original)).toBeUndefined();
  });
});
