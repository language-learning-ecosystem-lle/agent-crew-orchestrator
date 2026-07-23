/**
 * Тред: шапка-источник (`_meta.md`), сообщения-файлы и ПРОИЗВОДНЫЙ `_thread.md`.
 *
 * ГРАНИЦА ИСТОЧНИКОВ, и она же ответ на вопрос «где живёт waiting-on»:
 * `_meta.md` — источник только для `title`, `participants` и `status` (их
 * правят curator/john: закрытие треда это приёмка). `waiting-on` живёт в
 * заголовках сообщений и в `_meta.md` НЕ дублируется — иначе у поля два
 * писателя, ровно тот дефект, который закрывали в треде 006 для INDEX.
 *
 * ДВЕ ФОРМЫ ЧИТАЮТСЯ ОДНОВРЕМЕННО. Пока идёт переезд, часть тредов лежит
 * файлами, часть — единым legacy-`_thread.md`. Генератор умеет обе: только так
 * треды переезжают по одному и «дня переключения» не существует.
 *
 * КАНОН СБОРКИ проверен фактом: на 12 живых тредах (97 секций) склейка
 * воспроизводит существующие файлы БАЙТ-В-БАЙТ. Поэтому у миграции есть
 * побайтовый гард, а не «выглядит похоже».
 */
import {
  EXPECTS,
  type Expects,
  type Message,
  type MessageFields,
  MessageFormatError,
  renderHeading,
} from "./message.js";

export type ThreadStatus = "open" | "closed";

export type ThreadMeta = {
  readonly title: string;
  readonly participants: readonly string[];
  readonly status: ThreadStatus;
};

export type Thread = {
  readonly id: string;
  readonly meta: ThreadMeta;
  readonly messages: readonly Message[];
};

const FENCE = "---";
const HEAD = /^# (?<title>.+)\n\nparticipants: (?<participants>.+) · status: (?<status>[a-z]+)\n\n/;
const HEADING =
  /^## msg-(?<msg>\d+) · from: (?<from>[a-z][a-z0-9-]*) · (?<date>\d{4}-\d{2}-\d{2}) · expects: (?<expects>[a-z]+)(?<suffix> · .+)?$/;

const parseParticipants = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

export const parseMetaFile = (raw: string): ThreadMeta => {
  const lines = raw.split("\n");
  if (lines[0] !== FENCE)
    throw new MessageFormatError("_meta.md обязан начинаться со строки '---'");
  const close = lines.indexOf(FENCE, 1);
  if (close === -1) throw new MessageFormatError("_meta.md: не закрыт заголовок ('---')");

  const raws = new Map<string, string>();
  for (const line of lines.slice(1, close)) {
    if (line.trim() === "") continue;
    const at = line.indexOf(":");
    if (at === -1) throw new MessageFormatError(`_meta.md: строка без 'ключ: значение': '${line}'`);
    raws.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }

  const title = raws.get("title");
  const participants = raws.get("participants");
  const status = raws.get("status");
  if (!title || !participants || !status) {
    throw new MessageFormatError("_meta.md: обязательны 'title', 'participants', 'status'");
  }
  if (status !== "open" && status !== "closed") {
    throw new MessageFormatError(`_meta.md: 'status: ${status}' — допустимо open | closed`);
  }

  return { title, participants: parseParticipants(participants), status };
};

export const renderMetaFile = (meta: ThreadMeta): string =>
  `${FENCE}\ntitle: ${meta.title}\nparticipants: ${meta.participants.join(", ")}\nstatus: ${meta.status}\n${FENCE}\n`;

/** Сборка `_thread.md`: голова из `_meta.md` + секции из сообщений по порядку файлов. */
export const renderThread = (meta: ThreadMeta, messages: readonly Message[]): string => {
  const head = `# ${meta.title}\n\nparticipants: ${meta.participants.join(", ")} · status: ${meta.status}\n\n`;
  return messages.reduce((acc, message, at) => {
    const heading = renderHeading(message.fields, at + 1);
    const tail = at + 1 < messages.length ? "\n\n" : "\n";
    return `${acc}${heading}\n\n${message.text}${tail}`;
  }, head);
};

/**
 * Разбор ЕДИНОГО legacy-`_thread.md` — нужен и для миграции, и для тредов,
 * которые ещё не переехали.
 *
 * Секции режутся срезами по смещениям, а не склейкой строк: склейка теряет
 * разделительный перевод строки между секциями, и побайтовое сравнение потом
 * врёт (поймано пробой перед реализацией).
 */
export const parseLegacyThread = (
  id: string,
  raw: string,
  knownRoles: readonly string[],
): Thread => {
  const head = HEAD.exec(raw);
  if (!head?.groups) {
    throw new MessageFormatError(
      `${id}: шапка не разобрана — ожидались '# заголовок', пустая строка и 'participants: … · status: …'`,
    );
  }
  const status = head.groups.status;
  if (status !== "open" && status !== "closed") {
    throw new MessageFormatError(`${id}: 'status: ${status}' — допустимо open | closed`);
  }

  const meta: ThreadMeta = {
    title: head.groups.title ?? "",
    participants: parseParticipants(head.groups.participants ?? ""),
    status,
  };

  const starts: number[] = [];
  const re = /^## msg-/gm;
  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) starts.push(m.index);

  const messages: Message[] = [];
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k] as number;
    const to = k + 1 < starts.length ? (starts[k + 1] as number) : raw.length;
    const section = raw.slice(from, to);
    const nl = section.indexOf("\n");
    const heading = section.slice(0, nl);
    const body = section.slice(nl + 1);

    const parsed = HEADING.exec(heading);
    if (!parsed?.groups) throw new MessageFormatError(`${id}: заголовок не разобран: '${heading}'`);
    const expects = parsed.groups.expects ?? "";
    if (!(EXPECTS as readonly string[]).includes(expects)) {
      throw new MessageFormatError(`${id}: 'expects: ${expects}' в '${heading}'`);
    }

    const text = body.replace(/^\n+/, "").replace(/\n+$/, "");
    const declared = declaredWaitingOn(text, knownRoles);
    const suffix = parsed.groups.suffix?.replace(/^ · /, "");

    const fields: MessageFields = {
      msg: Number(parsed.groups.msg),
      from: parsed.groups.from ?? "",
      date: parsed.groups.date ?? "",
      expects: expects as Expects,
      ...(declared === undefined ? {} : { waitingOn: declared }),
      ...(suffix === undefined ? {} : { suffix }),
    };
    messages.push({ fields, text });
  }

  return { id, meta, messages };
};

/**
 * Объявление ожидания в ТЕЛЕ (legacy-форма) — перенос правил bash-генератора
 * один в один, включая выученное:
 *
 * - стрелка должна стоять сразу после слова (`waiting-on → …`): это синтаксис, а
 *   не оборот речи, иначе пересказ «waiting-on остаётся на john» принимается за
 *   объявление;
 * - режем по ПОСЛЕДНЕМУ `waiting-on`, а не по первой стрелке: стрелка ходовой
 *   символ в прозе, и разбор по первой уводил хвост в середину предложения;
 * - пояснения в скобках вычищаются до разбора ролей;
 * - роли ищутся по известным именам, а не разрезанием по запятым: разделитель в
 *   живых сообщениях бывает и запятой, и тире, и союзом.
 *
 * `undefined` — объявления нет (ход не передавался). Пустой массив — объявление
 * есть, но ролей в нём не нашлось («—»).
 */
export const declaredWaitingOn = (
  text: string,
  knownRoles: readonly string[],
): string[] | undefined => {
  const lines = text.split("\n").filter((line) => /waiting-on[`*:\s0-9]*→/.test(line));
  const line = lines.at(-1);
  if (line === undefined) return undefined;

  const afterWord = line.slice(line.lastIndexOf("waiting-on"));
  const afterArrow = afterWord.slice(afterWord.indexOf("→") + 1);
  const cleaned = afterArrow.replaceAll(/\([^)]*\)/g, "").replaceAll(/[`*]/g, "");

  const found: string[] = [];
  for (const role of knownRoles) {
    const at = new RegExp(`(^|[^a-z-])${role}([^a-z-]|$)`).test(cleaned);
    if (at && !found.includes(role)) found.push(role);
  }
  // Порядок — как в строке, а не как в реестре ролей: состав читается человеком.
  return found.sort((a, b) => cleaned.indexOf(a) - cleaned.indexOf(b));
};

/**
 * Текущее ожидание треда: ПОСЛЕДНЕЕ объявление, а не поле последней секции.
 * Последняя секция сплошь и рядом не передаёт ход (уведомитель о merge,
 * follow-up с `expects: none`, реплика без передачи) — читать её буквально
 * значит обнулить ожидание и оставить роль неразбуженной.
 *
 * `status: closed` приоритетнее любого объявления: закрытый тред не ждёт никого.
 */
export const waitingOnOf = (thread: Thread): readonly string[] => {
  if (thread.meta.status === "closed") return [];
  for (let at = thread.messages.length - 1; at >= 0; at--) {
    const declared = thread.messages[at]?.fields.waitingOn;
    if (declared !== undefined) return declared;
  }
  return [];
};

/** Дата последнего сообщения — колонка `updated` реестра. */
export const updatedOf = (thread: Thread): string =>
  thread.messages.at(-1)?.fields.date.slice(0, 10) ?? "—";
