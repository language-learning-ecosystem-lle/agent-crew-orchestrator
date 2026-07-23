/**
 * Сообщение как ФАЙЛ (модель «одно сообщение — один файл», решение john
 * 2026-07-23, тред `012-agent-protocol-package`, msg-005 curator).
 *
 * Раньше сообщение было секцией общего `_thread.md`, и каждый писатель
 * дописывал общий файл. Это давало перепечатывание тела, порчу плейсхолдеров и
 * CAS-конфликты на одном файле. Теперь писатель создаёт СВОЙ файл, а `_thread.md`
 * собирается из файлов — гонок нет по построению.
 *
 * ЦЕНА, которую модель создаёт и которую здесь же закрываем: тихая правка
 * задним числом становится дешёвой (крошечный дифф, лента визуально та же).
 * Поэтому имя файла — идентификатор, а не порядковый номер, и валидатор
 * сверяет неизменность ранее закоммиченных файлов (`check.ts`).
 *
 * ЗАГОЛОВОК — ДАННЫЕ, А НЕ ПРОЗА. `waiting-on` парсился из тела последним
 * объявлением со стрелкой; из-за этого он терялся на пояснениях и оборотах
 * речи. Теперь это поле, а неизвестная роль в нём — красная проверка, а НЕ
 * молчаливый отброс: молчаливый отброс и был механизмом потери роли (боль 2).
 *
 * НОМЕР — ВИТРИНА. Он печатается в собранном треде для чтения человеком, но
 * идентичность даёт имя файла: в живом треде 012 номера уже дважды
 * столкнулись (два msg-005 и два msg-006 от разных ролей), то есть номер не
 * идентификатор по факту, а не по опасению. Мигрированные сообщения хранят
 * исторический номер в поле `msg` — иначе ссылки «см. msg-003 п.4» в уже
 * написанных телах перестали бы указывать на то, на что указывали.
 */

/** `expects` — чего автор ждёт: содержательного ответа, подтверждения или ничего. */
export const EXPECTS = ["answer", "ack", "none"] as const;
export type Expects = (typeof EXPECTS)[number];

export type MessageFields = {
  /** Исторический номер (только у мигрированных): сохраняет ссылки в старых телах. */
  readonly msg?: number;
  /**
   * ПОЗИЦИЯ в треде (только у мигрированных) — ИСТОЧНИК ПОРЯДКА сообщений
   * (`compareMessageEntries`), а не имя файла. Имя мигрированного ведёт датой, а
   * дата НЕ монотонна порядку ленты: уведомитель стамповал merge #27 датой
   * 2026-07-23, дописав секцию ПОСЛЕ сообщений 2026-07-24 (job до полуночи UTC,
   * retry-цикл допушил после). Сортировка ИМЁН тогда переставляла бы сообщение —
   * ловил `verifyMigration` (тред 012). `seq` монотонен по построению, порядок
   * держит он. Исторический `msg` дублируется (в 011/012 два msg-002) и остаётся
   * только в заголовке для ссылок «см. msg-002».
   */
  readonly seq?: number;
  readonly from: string;
  /** Новые — метка UTC `2026-07-23T13:45:12Z`; мигрированные — только дата. */
  readonly date: string;
  readonly expects: Expects;
  /**
   * Полный ОСТАТОЧНЫЙ состав ожидания, а не дельта. Отсутствие поля — «ход не
   * передаю» (наследуется предыдущее), пустой список — ожидание снято.
   */
  readonly waitingOn?: readonly string[];
  /** Хвост заголовка из истории (`· [СВЕРХПИСАНО msg-002]`), чтобы склейка совпала байт-в-байт. */
  readonly suffix?: string;
};

export type Message = {
  readonly fields: MessageFields;
  /** Тело без обрамляющих пустых строк: их расставляет сборка. */
  readonly text: string;
};

const FENCE = "---";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ROLE = /^[a-z][a-z0-9-]*$/;

export class MessageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageFormatError";
  }
}

const parseList = (value: string): string[] =>
  value === "—" || value.trim() === ""
    ? []
    : value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "");

/** Разбор файла сообщения: front-matter в `---` + тело. */
export const parseMessageFile = (raw: string): Message => {
  const lines = raw.split("\n");
  if (lines[0] !== FENCE) {
    throw new MessageFormatError("файл сообщения обязан начинаться со строки '---'");
  }
  const close = lines.indexOf(FENCE, 1);
  if (close === -1) throw new MessageFormatError("не закрыт заголовок сообщения ('---')");

  const raws = new Map<string, string>();
  for (const line of lines.slice(1, close)) {
    if (line.trim() === "") continue;
    const at = line.indexOf(":");
    if (at === -1) throw new MessageFormatError(`строка заголовка без 'ключ: значение': '${line}'`);
    raws.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }

  const from = raws.get("from");
  const date = raws.get("date");
  const expects = raws.get("expects");
  if (!from || !date || !expects) {
    throw new MessageFormatError("в заголовке обязательны 'from', 'date' и 'expects'");
  }
  if (!ROLE.test(from)) throw new MessageFormatError(`'from: ${from}' — не похоже на id роли`);
  if (!DATE_ONLY.test(date) && !TIMESTAMP.test(date)) {
    throw new MessageFormatError(
      `'date: ${date}' — нужна метка UTC вида 2026-07-23T13:45:12Z (или дата у мигрированных)`,
    );
  }
  if (!(EXPECTS as readonly string[]).includes(expects)) {
    throw new MessageFormatError(`'expects: ${expects}' — допустимо ${EXPECTS.join(" | ")}`);
  }

  const msgRaw = raws.get("msg");
  const seqRaw = raws.get("seq");
  const waitingRaw = raws.get("waiting-on");
  const suffix = raws.get("suffix");

  const fields: MessageFields = {
    ...(msgRaw === undefined ? {} : { msg: Number(msgRaw) }),
    ...(seqRaw === undefined ? {} : { seq: Number(seqRaw) }),
    from,
    date,
    expects: expects as Expects,
    ...(waitingRaw === undefined ? {} : { waitingOn: parseList(waitingRaw) }),
    ...(suffix === undefined ? {} : { suffix }),
  };
  if (fields.msg !== undefined && !Number.isInteger(fields.msg)) {
    throw new MessageFormatError(`'msg: ${msgRaw}' — номер обязан быть целым`);
  }
  if (fields.seq !== undefined && !Number.isInteger(fields.seq)) {
    throw new MessageFormatError(`'seq: ${seqRaw}' — позиция обязана быть целой`);
  }

  return {
    fields,
    text: lines
      .slice(close + 1)
      .join("\n")
      .replace(/^\n+/, "")
      .replace(/\n+$/, ""),
  };
};

export const renderMessageFile = (message: Message): string => {
  const { fields, text } = message;
  const head = [
    ...(fields.msg === undefined ? [] : [`msg: ${String(fields.msg).padStart(3, "0")}`]),
    ...(fields.seq === undefined ? [] : [`seq: ${String(fields.seq).padStart(3, "0")}`]),
    `from: ${fields.from}`,
    `date: ${fields.date}`,
    `expects: ${fields.expects}`,
    ...(fields.waitingOn === undefined
      ? []
      : [`waiting-on: ${fields.waitingOn.length === 0 ? "—" : fields.waitingOn.join(", ")}`]),
    ...(fields.suffix === undefined ? [] : [`suffix: ${fields.suffix}`]),
  ];
  return `${FENCE}\n${head.join("\n")}\n${FENCE}\n\n${text}\n`;
};

/**
 * Имя файла — ИДЕНТИФИКАТОР сообщения (уникальность + читаемость), НЕ ключ
 * порядка: порядок в треде задаёт `compareMessageEntries` по `seq`, а не
 * лексикографика имени. Раньше имя было и тем и другим, и на немонотонной дате
 * (уведомление о merge #27, тред 012) сортировка имён переставляла сообщение.
 *
 * Новое: `2026-07-23T13-45-12Z-dev-core.md` — двоеточия метки заменены дефисом
 * (в имени законны, но недружелюбны); коллизия возможна только при двух
 * сообщениях одной роли в одну секунду.
 *
 * Мигрированное: `2026-07-21-003-curator.md` — времени в истории нет, есть дата
 * и ПОЗИЦИЯ (`seq`), НЕ исторический номер (он дублируется). Оба формата
 * различимы глазом.
 */
export const messageFileName = (fields: MessageFields): string => {
  if (fields.msg === undefined) return `${fields.date.replaceAll(":", "-")}-${fields.from}.md`;
  if (fields.seq === undefined) {
    throw new MessageFormatError(
      "у мигрированного сообщения есть 'msg', но нет 'seq' — имя строится из позиции, не из номера",
    );
  }
  return `${fields.date}-${String(fields.seq).padStart(3, "0")}-${fields.from}.md`;
};

/**
 * Порядок сообщений в треде. Ключ — ПОЗИЦИЯ (`seq`), а не имя файла: имя ведёт
 * датой, а дата бывает немонотонна порядку ленты (перекос часов писателя,
 * граница полуночи UTC — реальный msg-069 в треде 012). `seq` монотонен по
 * построению миграции, поэтому источник порядка — он.
 *
 * Новые (пост-миграционные) сообщения `seq` не несут: они всегда идут ПОСЛЕ
 * мигрированных (дописаны позже по определению), а между собой — по имени файла,
 * где ключ снова верный: метка времени монотонна.
 */
export const compareMessageEntries = (
  a: { readonly fileName: string; readonly message: Message },
  b: { readonly fileName: string; readonly message: Message },
): number => {
  const sa = a.message.fields.seq;
  const sb = b.message.fields.seq;
  if (sa !== undefined && sb !== undefined) return sa - sb;
  if (sa !== undefined) return -1;
  if (sb !== undefined) return 1;
  return a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0;
};

/** Заголовок секции в собранном треде. `number` — витрина: позиция или исторический номер. */
export const renderHeading = (fields: MessageFields, number: number): string => {
  const shown = fields.msg ?? number;
  const suffix = fields.suffix === undefined ? "" : ` · ${fields.suffix}`;
  return `## msg-${String(shown).padStart(3, "0")} · from: ${fields.from} · ${fields.date.slice(0, 10)} · expects: ${fields.expects}${suffix}`;
};
