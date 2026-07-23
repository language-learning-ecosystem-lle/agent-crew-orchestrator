/**
 * Валидатор формата — единственная защита новой модели.
 *
 * Размен, принятый осознанно (решение john, msg-005 треда 012): порча тела
 * треда становится НЕВОЗМОЖНОЙ по построению (писатель трогает только свой
 * файл), а кривой формат — ЛОВИМЫМ НЕМЕДЛЕННО. Раз запись больше не проходит
 * через код, проверка после записи — всё, что у нас есть, и потому она обязана
 * быть придирчивой.
 *
 * Что проверяется и почему именно это:
 *
 * - **`from` и роли в `waiting-on` известны реестру.** Неизвестная роль в
 *   старом разборе отбрасывалась МОЛЧА — это и был механизм потери роли из
 *   объявления (боль 2). Опечатка `jonh` дала бы пустое ожидание и тишину,
 *   неотличимую от штатной работы.
 * - **Имя файла соответствует полям.** Имя — идентификатор сообщения; разъехавшись
 *   с содержимым, оно перестаёт им быть.
 * - **В теле нет строк `## msg-`** — они развалили бы склейку: сборщик режет тред
 *   ровно по ним.
 * - **Тело непусто** — пустое сообщение в ленте это молчание, выглядящее как ход.
 * Чего здесь СОЗНАТЕЛЬНО НЕТ: проверки «даты не убывают в порядке имён». Имя
 * файла выводится из даты, поэтому порядок имён и порядок дат совпадают по
 * построению — такая проверка не может сработать никогда и давала бы ложное
 * ощущение покрытия. Настоящий её вариант — «порядок имён против порядка
 * КОММИТОВ» (перекос часов писателя виден только там) — живёт на git-слое
 * рядом с проверкой неизменности, а не здесь.
 * - **Собранный `_thread.md` совпадает с закоммиченным** — иначе производное
 *   разошлось с источником, и человек читает не то, что есть.
 * - **Ранее закоммиченные файлы не изменились** (`checkImmutable`, включается
 *   флагом `--since <ref>`: без точки в истории вопрос «правили ли задним
 *   числом» не имеет смысла, а молчание об этом читалось бы как «цело»). Модель
 *   файл-на-сообщение делает тихую правку задним числом дешёвой: дифф крошечный,
 *   лента визуально та же. Технически правку не запрещаем, но она обязана
 *   оставлять красный след — раньше эту роль играла физика общего файла.
 */
import type { RoleRegistry } from "../roles/registry.js";
import { type Message, messageFileName } from "./message.js";
import { renderThread, type ThreadMeta } from "./thread.js";

export type MessageEntry = {
  readonly fileName: string;
  readonly message: Message;
};

export type ThreadInput = {
  readonly id: string;
  readonly meta: ThreadMeta;
  /** Сообщения В ПОРЯДКЕ ИМЁН ФАЙЛОВ — том же, в котором их склеит сборщик. */
  readonly entries: readonly MessageEntry[];
  /** Закоммиченный производный файл, если он есть. */
  readonly threadDoc?: string;
};

export type CheckIssue = {
  readonly thread: string;
  readonly file?: string;
  readonly message: string;
};

export const checkThread = (input: ThreadInput, registry: RoleRegistry): CheckIssue[] => {
  const issues: CheckIssue[] = [];
  const at = (file: string, message: string): void => {
    issues.push({ thread: input.id, file, message });
  };

  for (const participant of input.meta.participants) {
    if (!registry.isKnown(participant)) {
      issues.push({
        thread: input.id,
        file: "_meta.md",
        message: `участник '${participant}' не значится ролью в конфиге`,
      });
    }
  }

  for (const entry of input.entries) {
    const { fields, text } = entry.message;

    if (!registry.isKnown(fields.from)) {
      at(entry.fileName, `'from: ${fields.from}' — такой роли нет в конфиге`);
    }
    for (const role of fields.waitingOn ?? []) {
      if (!registry.isKnown(role)) {
        at(entry.fileName, `в 'waiting-on' роль '${role}', которой нет в конфиге`);
      }
    }

    const expected = messageFileName(fields);
    if (expected !== entry.fileName) {
      at(entry.fileName, `имя файла разошлось с заголовком, ожидалось '${expected}'`);
    }

    if (text.trim() === "") at(entry.fileName, "тело сообщения пусто");
    if (/^## msg-/m.test(text)) {
      at(entry.fileName, "в теле строка '## msg-' — склейка треда развалится об неё");
    }
  }

  if (input.threadDoc !== undefined) {
    const rendered = renderThread(
      input.meta,
      input.entries.map((entry) => entry.message),
    );
    if (rendered !== input.threadDoc) {
      issues.push({
        thread: input.id,
        file: "_thread.md",
        message: "производный файл разошёлся с сообщениями — пересоберите его",
      });
    }
  }

  return issues;
};

/**
 * Ранее закоммиченные файлы сообщений неизменны. `previous`/`current` — карты
 * «путь → содержимое» из двух состояний ветки.
 */
export const checkImmutable = (
  previous: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): CheckIssue[] => {
  const issues: CheckIssue[] = [];
  for (const [path, was] of previous) {
    const now = current.get(path);
    if (now === undefined) {
      issues.push({ thread: path, message: "файл сообщения удалён — лента append-only" });
      continue;
    }
    if (now !== was) {
      issues.push({
        thread: path,
        message: "файл сообщения изменён после коммита — правка задним числом",
      });
    }
  }
  return issues;
};

export type { Message };
