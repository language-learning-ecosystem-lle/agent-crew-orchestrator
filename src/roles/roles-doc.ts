/**
 * Сверка «документ для людей ↔ конфиг для кода».
 *
 * `ROLES.md` остаётся тем, что читают человек и агент при онбординге, а
 * конфиг — тем, из чего выводится поведение. Два описания одного набора ролей
 * расходятся по построению (это ровно урок треда 006 про INDEX), поэтому
 * расхождение должно быть ВИДИМЫМ, а не обнаруживаться в момент, когда роль
 * не разбудили.
 *
 * Генерировать `ROLES.md` из конфига на P1 сознательно НЕ стал: документ несёт
 * прозу, которая из данных не выводится (модель «PM-владелец + ассистент»,
 * правила стыков между зонами, жизненный цикл). Сгенерировать таблицу и
 * потерять прозу — плохой размен; сверять — дешёвый и честный.
 *
 * РАЗБОР ТАБЛИЦЫ повторяет правило, которым живёт генератор реестра: роли
 * берутся ТОЛЬКО из строк ПОСЛЕ разделителя `|---|`. Иначе ячейка `id` из
 * строки-заголовка проходит любой фильтр «строчные латинские» и становится
 * ролью-призраком (тред 011, диагностика 3.2). Здесь это не «починенный
 * парсер», а тест: заголовок ролью не является, и это утверждение проверяется.
 */
import type { RoleRegistry } from "./registry.js";

export type RolesDocRow = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
};

export type RolesDocDrift =
  | { readonly kind: "missing-in-doc"; readonly id: string; readonly message: string }
  | { readonly kind: "missing-in-config"; readonly id: string; readonly message: string }
  | {
      readonly kind: "field-mismatch";
      readonly id: string;
      readonly field: "kind" | "status";
      readonly doc: string;
      readonly config: string;
      readonly message: string;
    };

const ROLE_ID = /^[a-z][a-z0-9-]*$/;
const SEPARATOR_ROW = /^\|[\s:|-]+\|$/;

/** Ячейка без markdown-оформления: `**active**` и `` `dev-core` `` — это то же слово. */
const cell = (value: string): string => value.replaceAll(/[*`]/g, "").trim();

const splitRow = (line: string): string[] =>
  line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((part) => cell(part));

/**
 * Строки таблицы ролей из markdown. Таблица определяется первым разделителем:
 * до него — заголовок, после — данные; строка, переставшая быть таблицей,
 * заканчивает разбор.
 */
export const parseRolesDocTable = (markdown: string): RolesDocRow[] => {
  const rows: RolesDocRow[] = [];
  let inTable = false;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();

    if (!inTable) {
      if (SEPARATOR_ROW.test(line)) inTable = true;
      continue;
    }

    if (!line.startsWith("|")) {
      // Таблица кончилась. Дальше в документе идут прозаические разделы —
      // вторая таблица ролью не считается, роли объявлены ровно одной.
      break;
    }

    const columns = splitRow(line);
    const [id, kind, status] = columns;
    if (id === undefined || kind === undefined || status === undefined) continue;
    if (!ROLE_ID.test(id)) continue;

    rows.push({ id, kind, status });
  }

  return rows;
};

/** Расхождения между реестром (кодом) и таблицей (документом). Пусто — сходятся. */
export const diffRolesDoc = (registry: RoleRegistry, markdown: string): RolesDocDrift[] => {
  const drift: RolesDocDrift[] = [];
  const rows = parseRolesDocTable(markdown);
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const id of registry.ids()) {
    const role = registry.get(id);
    if (role === undefined) continue;
    const row = byId.get(id);

    if (!row) {
      drift.push({
        kind: "missing-in-doc",
        id,
        message: `роль '${id}' есть в конфиге, но её нет в таблице ROLES.md`,
      });
      continue;
    }

    if (row.kind !== role.kind) {
      drift.push({
        kind: "field-mismatch",
        id,
        field: "kind",
        doc: row.kind,
        config: role.kind,
        message: `роль '${id}': тип в доке '${row.kind}', в конфиге '${role.kind}'`,
      });
    }

    if (row.status !== role.status) {
      drift.push({
        kind: "field-mismatch",
        id,
        field: "status",
        doc: row.status,
        config: role.status,
        message: `роль '${id}': статус в доке '${row.status}', в конфиге '${role.status}'`,
      });
    }
  }

  for (const row of rows) {
    if (registry.isKnown(row.id)) continue;
    drift.push({
      kind: "missing-in-config",
      id: row.id,
      message: `роль '${row.id}' есть в таблице ROLES.md, но её нет в конфиге — контур о ней не знает`,
    });
  }

  return drift;
};
