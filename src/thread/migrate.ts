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
 * на то, на что указывали. Порядок держит `seq` (позиция) в имени файла, а не
 * исторический номер: номера дублируются и переставили бы сообщения при
 * сортировке имён — см. `verifyMigration` (второе условие).
 */
import { type Message, messageFileName, parseMessageFile, renderMessageFile } from "./message.js";
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
   * Два сообщения, дающие одно имя файла. С именем из `seq` (позиция уникальна
   * по треду) это СТРУКТУРНО НЕВОЗМОЖНО из текущего `migrateLegacyThread` —
   * массив всегда пуст. Оставлено НЕ как рабочая защита, а как sanity-guard от
   * будущего бага в генерации имён: если `seq` однажды перестанет быть
   * уникальным, коллизия поймается здесь, а не всплывёт потерей сообщения при
   * регенерации. Раньше имя строилось из дублирующегося номера, и это была
   * реальная защита; теперь — страховка.
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

  // Позиция (`seq`) — порядковый индекс секции, он идёт в имя файла и
  // обеспечивает, что сортировка имён при загрузке = исходный порядок. `msg`
  // (исторический) остаётся в заголовке для ссылок.
  const seqed: Message[] = thread.messages.map((message, at) => ({
    ...message,
    fields: { ...message.fields, seq: at + 1 },
  }));

  const files: MigratedFile[] = [
    { path: "_meta.md", content: renderMetaFile(thread.meta) },
    ...seqed.map((message) => ({
      path: `messages/${messageFileName(message.fields)}`,
      content: renderMessageFile(message),
    })),
    { path: "_thread.md", content: renderThread(thread.meta, seqed) },
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

const firstDiff = (a: string, b: string): string => {
  for (let at = 0; at < Math.max(a.length, b.length); at++) {
    if (a[at] !== b[at]) {
      const from = Math.max(0, at - 40);
      return `расхождение на байте ${at}: было ${JSON.stringify(
        a.slice(from, at + 20),
      )}, стало ${JSON.stringify(b.slice(from, at + 20))}`;
    }
  }
  return "длины совпали, но содержимое различается";
};

/**
 * Гард миграции — ДВА условия, оба обязательны:
 *
 * 1. Склейка из ПАМЯТИ (сообщения в исходном порядке) воспроизводит исходный
 *    `_thread.md` байт-в-байт.
 * 2. Склейка после ЗАГРУЗКИ С ДИСКА (сообщения, отсортированные по имени файла —
 *    ровно как это делает `loadThread`) даёт тот же результат.
 *
 * Второе условие добавлено потому, что первого НЕДОСТАТОЧНО: имя мигрированного
 * файла раньше кодировало исторический номер, и при дублирующихся номерах
 * (011/012) сортировка имён переставляла сообщения — склейка из памяти была
 * верной, а из файлов на диске врала. Поймано командой `derive` уже ПОСЛЕ
 * миграции; теперь ловится в гарде, до записи. `seq` в имени эту перестановку
 * закрывает, но гард обязан это ДОКАЗЫВАТЬ, а не полагаться.
 */
export const verifyMigration = (migration: Migration, original: string): string | undefined => {
  const rebuilt = migration.files.find((file) => file.path === "_thread.md")?.content;
  if (rebuilt === undefined) return "миграция не собрала _thread.md";
  if (rebuilt !== original) return `склейка из памяти: ${firstDiff(original, rebuilt)}`;

  // Симуляция loadThread: сообщения из messages/, отсортированные по имени.
  const fromDisk = migration.files
    .filter((file) => file.path.startsWith("messages/"))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => parseMessageFile(file.content));
  const rebuiltFromDisk = renderThread(migration.meta, fromDisk);
  if (rebuiltFromDisk !== original) {
    return `склейка после загрузки с диска (сортировка имён): ${firstDiff(original, rebuiltFromDisk)}`;
  }

  return undefined;
};
