/**
 * Чтение каталога разговоров с диска. Единственный слой, знающий про `fs`:
 * всё выше — функции «строка → строка», и потому проверяются тестами без
 * файловой системы.
 *
 * ДВЕ ФОРМЫ ЖИВУТ ОДНОВРЕМЕННО и различаются наличием `messages/`: тред
 * переехал — читаем файлы, не переехал — разбираем legacy-`_thread.md`. Только
 * так треды мигрируют по одному, без «дня переключения» и без простоя контура.
 *
 * СБОЙ ОДНОГО ТРЕДА НЕ ОСЛЕПЛЯЕТ КОНТУР (постановка curator, тред 012, 21:35).
 * Раньше `loadThreads` разбирал треды подряд и первое же исключение уносило
 * ВЕСЬ вызов — то есть `mail`, вахту и тик демона для всех ролей сразу. Так и
 * случилось: один файл сообщения, попавший в legacy-тред 009 без `_meta.md`,
 * положил почту всему контуру. В режиме без человека рядом это выглядело бы как
 * «ночью ничего не пришло».
 *
 * Требование — ИЗОЛЯЦИЯ, а не валидация формы: сбойный тред помечается, его
 * ожидание в расчёт не идёт, причина называется громко (id треда + что именно
 * не так), остальные читаются как обычно. Поэтому `loadThreads` возвращает не
 * массив, а ПАРУ «прочитанные + сбойные»: тип заставляет каждого вызывающего
 * решить, что он делает со сбойными, вместо молчаливого пропуска.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { MessageEntry, ThreadInput } from "../thread/check.js";
import { compareMessageEntries, parseMessageFile } from "../thread/message.js";
import { parseLegacyThread, parseMetaFile, type Thread } from "../thread/thread.js";

const THREAD_DIR = /^\d{3}-/;

export type LoadedThread = {
  readonly thread: Thread;
  readonly input?: ThreadInput;
  /** true — тред ещё не переехал на файлы сообщений. */
  readonly legacy: boolean;
};

/** Тред, который прочитать не удалось: id + ЧТО ИМЕННО не так, человеку. */
export type ThreadFailure = {
  readonly id: string;
  readonly problem: string;
};

/** Результат обхода каталога: прочитанные треды и сбойные — раздельно. */
export type LoadedThreads = {
  readonly threads: readonly LoadedThread[];
  readonly failures: readonly ThreadFailure[];
};

export const loadThread = (
  dir: string,
  id: string,
  knownRoles: readonly string[],
): LoadedThread => {
  const messagesDir = join(dir, "messages");
  const threadDocPath = join(dir, "_thread.md");
  const metaPath = join(dir, "_meta.md");

  if (!existsSync(messagesDir)) {
    const raw = readFileSync(threadDocPath, "utf8");
    return { thread: parseLegacyThread(id, raw, knownRoles), legacy: true };
  }

  // ПОЛУ-МИГРИРОВАННЫЙ ТРЕД называется своим именем. Форму различает наличие
  // `messages/`, поэтому файл сообщения, положенный в legacy-тред руками (мимо
  // `new-message`, который такую запись отказывается делать), переводит тред в
  // мигрированную ветку — и та падает на отсутствующем `_meta.md`. Сырой ENOENT
  // по пути файла заставлял бы читателя выводить состояние самому.
  if (!existsSync(metaPath)) {
    throw new Error(
      `полу-мигрированный тред: есть 'messages/', но нет '_meta.md'` +
        (existsSync(threadDocPath)
          ? " (рядом лежит legacy-'_thread.md' — либо домигрируйте тред, либо верните сообщение в него)"
          : ""),
    );
  }

  const meta = parseMetaFile(readFileSync(metaPath, "utf8"));
  // Порядок — по `seq` (`compareMessageEntries`), НЕ по имени файла: имя ведёт
  // датой, а дата бывает немонотонна ленте (msg-069 в 012). Сначала читаем,
  // потом сортируем компаратором — плоский `.sort()` имён врал бы.
  const entries: MessageEntry[] = readdirSync(messagesDir)
    .filter((name) => name.endsWith(".md"))
    .map((fileName) => ({
      fileName,
      message: parseMessageFile(readFileSync(join(messagesDir, fileName), "utf8")),
    }))
    .sort(compareMessageEntries);

  const input: ThreadInput = {
    id,
    meta,
    entries,
    ...(existsSync(threadDocPath) ? { threadDoc: readFileSync(threadDocPath, "utf8") } : {}),
  };

  return {
    thread: { id, meta, messages: entries.map((entry) => entry.message) },
    input,
    legacy: false,
  };
};

/**
 * Обход каталога разговоров. Нечитаемый КОРЕНЬ — по-прежнему исключение наружу
 * (это не «часть почты сломана», это «почты нет вовсе»), а вот сбой отдельного
 * треда изолируется: он уходит в `failures` со своей причиной, остальные
 * читаются.
 */
export const loadThreads = (root: string, knownRoles: readonly string[]): LoadedThreads => {
  const threads: LoadedThread[] = [];
  const failures: ThreadFailure[] = [];

  for (const name of readdirSync(root)
    .filter((entry) => THREAD_DIR.test(entry) && statSync(join(root, entry)).isDirectory())
    .sort()) {
    try {
      threads.push(loadThread(join(root, name), name, knownRoles));
    } catch (error) {
      failures.push({ id: name, problem: (error as Error).message });
    }
  }

  return { threads, failures };
};

/** Сбойные треды одной читаемой строкой на каждый — для stderr вызывающего. */
export const renderThreadFailures = (failures: readonly ThreadFailure[]): string[] =>
  failures.map((failure) => `тред '${failure.id}' не прочитан: ${failure.problem}`);
