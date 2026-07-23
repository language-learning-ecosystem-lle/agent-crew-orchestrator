/**
 * Создание сообщений и тредов — операции записи, которые ДЕЛАЮТ файловую запись
 * в немигрированный тред невозможной по построению, а не запрещённой правилом.
 *
 * Риск, который это закрывает (тред 012, msg-034/053/056): `loadThread` при
 * наличии `messages/` читает файлы и ИГНОРИРУЕТ legacy `_thread.md`. Значит
 * первая файловая запись в ещё не мигрированный тред заставила бы генератор
 * пересобрать ленту из ОДНОГО файла — то есть обрезать историю треда. Пока
 * тред в legacy-форме, писать в него файлом нельзя, и это должен гарантировать
 * инструмент, а не дисциплина автора: правило, которое держится дисциплиной, —
 * не правило (общий вывод дня).
 *
 * Здесь — чистое ядро (планирование файлов), «строка → файлы». Само создание на
 * диске и git — в CLI над этим.
 */
import type { MessageFields } from "./message.js";
import { messageFileName, renderMessageFile } from "./message.js";
import { renderMetaFile, type ThreadMeta } from "./thread.js";

export type PlannedFile = {
  readonly path: string;
  readonly content: string;
};

export class WriteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteRefusedError";
  }
}

/** UTC-метка сообщения из момента времени: `2026-07-24T10:30:00Z` (без миллисекунд). */
export const messageTimestamp = (at: Date): string => `${at.toISOString().slice(0, 19)}Z`;

export type NewMessageInput = {
  readonly from: string;
  readonly date: string;
  readonly expects: MessageFields["expects"];
  readonly waitingOn?: readonly string[];
  readonly text: string;
  /** true — у треда есть `messages/` (мигрирован/файловый). false — legacy. */
  readonly threadHasMessages: boolean;
};

/**
 * Файл нового сообщения для существующего файлового треда.
 *
 * ОТКАЗ, а не создание, если тред ещё в legacy-форме: `threadHasMessages=false`
 * ловит именно тот случай, из-за которого весь гард и заводится.
 */
export const planNewMessage = (input: NewMessageInput): PlannedFile => {
  if (!input.threadHasMessages) {
    throw new WriteRefusedError(
      "тред ещё в legacy-форме (нет messages/): файловая запись обрезала бы его историю. Сначала мигрируй тред.",
    );
  }
  if (input.text.trim() === "") {
    throw new WriteRefusedError("тело сообщения пусто");
  }

  const fields: MessageFields = {
    from: input.from,
    date: input.date,
    expects: input.expects,
    ...(input.waitingOn === undefined ? {} : { waitingOn: input.waitingOn }),
  };
  return {
    path: `messages/${messageFileName(fields)}`,
    content: renderMessageFile({ fields, text: input.text }),
  };
};

export type NewThreadInput = {
  readonly title: string;
  readonly participants: readonly string[];
  readonly from: string;
  readonly date: string;
  readonly expects: MessageFields["expects"];
  readonly waitingOn?: readonly string[];
  readonly text: string;
};

/**
 * Файлы нового треда СРАЗУ в файловой форме: `_meta.md` + первое сообщение в
 * `messages/`. Legacy-треды больше не рождаются — значит `new-message` в них
 * никогда не упрётся, а инвариант держится по построению.
 */
export const planNewThread = (input: NewThreadInput): PlannedFile[] => {
  if (input.text.trim() === "") throw new WriteRefusedError("тело первого сообщения пусто");

  const meta: ThreadMeta = {
    title: input.title,
    participants: input.participants,
    status: "open",
  };
  const first = planNewMessage({
    from: input.from,
    date: input.date,
    expects: input.expects,
    ...(input.waitingOn === undefined ? {} : { waitingOn: input.waitingOn }),
    text: input.text,
    threadHasMessages: true, // новый тред файловый по построению
  });

  return [{ path: "_meta.md", content: renderMetaFile(meta) }, first];
};
