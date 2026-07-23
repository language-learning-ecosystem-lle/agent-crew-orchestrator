/**
 * Чтение каталога разговоров с диска. Единственный слой, знающий про `fs`:
 * всё выше — функции «строка → строка», и потому проверяются тестами без
 * файловой системы.
 *
 * ДВЕ ФОРМЫ ЖИВУТ ОДНОВРЕМЕННО и различаются наличием `messages/`: тред
 * переехал — читаем файлы, не переехал — разбираем legacy-`_thread.md`. Только
 * так треды мигрируют по одному, без «дня переключения» и без простоя контура.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { MessageEntry, ThreadInput } from "../thread/check.js";
import { parseMessageFile } from "../thread/message.js";
import { parseLegacyThread, parseMetaFile, type Thread } from "../thread/thread.js";

const THREAD_DIR = /^\d{3}-/;

export type LoadedThread = {
  readonly thread: Thread;
  readonly input?: ThreadInput;
  /** true — тред ещё не переехал на файлы сообщений. */
  readonly legacy: boolean;
};

export const loadThread = (
  dir: string,
  id: string,
  knownRoles: readonly string[],
): LoadedThread => {
  const messagesDir = join(dir, "messages");
  const threadDocPath = join(dir, "_thread.md");

  if (!existsSync(messagesDir)) {
    const raw = readFileSync(threadDocPath, "utf8");
    return { thread: parseLegacyThread(id, raw, knownRoles), legacy: true };
  }

  const meta = parseMetaFile(readFileSync(join(dir, "_meta.md"), "utf8"));
  const entries: MessageEntry[] = readdirSync(messagesDir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((fileName) => ({
      fileName,
      message: parseMessageFile(readFileSync(join(messagesDir, fileName), "utf8")),
    }));

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

export const loadThreads = (root: string, knownRoles: readonly string[]): LoadedThread[] =>
  readdirSync(root)
    .filter((name) => THREAD_DIR.test(name) && statSync(join(root, name)).isDirectory())
    .sort()
    .map((name) => loadThread(join(root, name), name, knownRoles));
