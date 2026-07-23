/**
 * Миграция треда из единого `_thread.md` в файлы сообщений.
 *
 * ПОЧЕМУ С ГАРДОМ. Разрезание переписывает `_thread.md` целиком, то есть
 * формально трогает ЧУЖИЕ секции, а протокол append-only без исключений
 * (правило john, 2026-07-22). Единственное, что делает такую операцию
 * допустимой, — доказуемость: склейка мигрированных файлов обязана
 * воспроизводить исходный файл **байт-в-байт**. Не воспроизвела — миграция
 * треда не принята, и это не предупреждение, а отказ.
 *
 * Побайтовость достижима: канон сборки проверен пробой на 12 живых тредах
 * (97 секций) ДО реализации.
 *
 * Что сохраняется намеренно: исторические номера (включая дубли — в треде 012
 * их два), хвосты заголовков вроде `[СВЕРХПИСАНО msg-002]`, исходный порядок.
 * Ссылки «см. msg-003 п.4» в уже написанных телах обязаны продолжать указывать
 * на то, на что указывали.
 */
import { messageFileName, renderMessageFile } from "./message.js";
import { parseLegacyThread, renderMetaFile, renderThread, type ThreadMeta } from "./thread.js";

export type MigratedFile = {
  readonly path: string;
  readonly content: string;
};

export type Migration = {
  readonly id: string;
  readonly meta: ThreadMeta;
  readonly files: readonly MigratedFile[];
  /**
   * Два сообщения, дающие одно имя файла (та же роль, та же дата, тот же
   * исторический номер). Это ОТКАЗ, а не предупреждение: запись такого треда
   * молча затёрла бы одно сообщение другим, а побайтовый гард этого не поймал
   * бы — он сверяет склейку из разобранных сообщений, а не то, что осталось на
   * диске. Потеря обнаружилась бы при следующей регенерации, когда источником
   * станут файлы.
   */
  readonly collisions: readonly string[];
};

export const migrateLegacyThread = (
  id: string,
  raw: string,
  knownRoles: readonly string[],
): Migration => {
  const thread = parseLegacyThread(id, raw, knownRoles);
  const collisions: string[] = [];

  const files: MigratedFile[] = [
    { path: "_meta.md", content: renderMetaFile(thread.meta) },
    ...thread.messages.map((message) => ({
      path: `messages/${messageFileName(message.fields)}`,
      content: renderMessageFile(message),
    })),
    { path: "_thread.md", content: renderThread(thread.meta, thread.messages) },
  ];

  const names = new Set<string>();
  for (const file of files) {
    if (names.has(file.path)) {
      collisions.push(`два сообщения дают одно имя файла: ${file.path}`);
    }
    names.add(file.path);
  }

  return { id, meta: thread.meta, files, collisions };
};

/**
 * Гард: склейка мигрированного воспроизводит исходник байт-в-байт.
 * Возвращает описание расхождения либо `undefined`, если всё сошлось.
 */
export const verifyMigration = (migration: Migration, original: string): string | undefined => {
  const rebuilt = migration.files.find((file) => file.path === "_thread.md")?.content;
  if (rebuilt === undefined) return "миграция не собрала _thread.md";
  if (rebuilt === original) return undefined;

  for (let at = 0; at < Math.max(rebuilt.length, original.length); at++) {
    if (rebuilt[at] !== original[at]) {
      const from = Math.max(0, at - 40);
      return `расхождение на байте ${at}: было ${JSON.stringify(
        original.slice(from, at + 20),
      )}, стало ${JSON.stringify(rebuilt.slice(from, at + 20))}`;
    }
  }
  return "длины совпали, но содержимое различается";
};
