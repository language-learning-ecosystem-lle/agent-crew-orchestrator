/**
 * A message as a FILE (the "one message — one file" model, john's decision
 * 2026-07-23, thread `012-agent-protocol-package`, msg-005 by curator).
 *
 * Previously a message was a section of a shared `_thread.md`, and every writer
 * appended to that shared file. That produced re-typed bodies, corrupted
 * placeholders and CAS conflicts on a single file. Now a writer creates ITS OWN
 * file and `_thread.md` is assembled from the files — races are gone by
 * construction.
 *
 * THE PRICE the model creates and which we settle right here: a quiet
 * after-the-fact edit becomes cheap (a tiny diff, the feed looks the same). Hence
 * the file name is an identifier rather than an ordinal, and the validator checks
 * the immutability of previously committed files (`check.ts`).
 *
 * THE HEADER IS DATA, NOT PROSE. `waiting-on` used to be parsed out of the body
 * as the last declaration with an arrow, which made it get lost on explanations
 * and turns of phrase. Now it is a field, and an unknown role in it is a red
 * check and NOT a silent drop: the silent drop was the very mechanism by which a
 * role got lost (pain 2).
 *
 * THE NUMBER IS A DISPLAY. It is printed in the assembled thread for humans to
 * read, but identity comes from the file name: in the live thread 012 the numbers
 * have already collided twice (two msg-005 and two msg-006 from different roles),
 * so the number is not an identifier as a matter of fact, not of worry. Migrated
 * messages keep their historical number in the `msg` field — otherwise references
 * like "see msg-003 item 4" in already-written bodies would stop pointing at what
 * they pointed at.
 */

/** `expects` — what the author awaits: a substantive answer, an acknowledgement or nothing. */
export const EXPECTS = ["answer", "ack", "none"] as const;
export type Expects = (typeof EXPECTS)[number];

export type MessageFields = {
  /** Historical number (migrated messages only): keeps references in old bodies working. */
  readonly msg?: number;
  /**
   * POSITION in the thread (migrated messages only) — the SOURCE OF MESSAGE ORDER
   * (`compareMessageEntries`), not the file name. A migrated file name leads with
   * a date, and the date is NOT monotonic with the feed order: the notifier
   * stamped merge #27 with 2026-07-23, appending a section AFTER the messages of
   * 2026-07-24 (the job ran before UTC midnight, the retry loop pushed later).
   * Sorting by NAME would then reorder the message — caught by `verifyMigration`
   * (thread 012). `seq` is monotonic by construction, so it holds the order. The
   * historical `msg` is duplicated (two msg-002 in 011/012) and stays in the
   * heading only, for "see msg-002" references.
   */
  readonly seq?: number;
  readonly from: string;
  /** New ones — a UTC stamp `2026-07-23T13:45:12Z`; migrated ones — a date only. */
  readonly date: string;
  readonly expects: Expects;
  /**
   * The full REMAINING set of who is awaited, not a delta. A missing field means
   * "I am not passing the turn" (the previous one is inherited), an empty list
   * means the waiting is lifted.
   */
  readonly waitingOn?: readonly string[];
  /** Heading tail from history (`· [СВЕРХПИСАНО msg-002]`, quoted verbatim from live data), so the assembly matches byte for byte. */
  readonly suffix?: string;
};

export type Message = {
  readonly fields: MessageFields;
  /** Body without the surrounding blank lines: the assembly places those. */
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

/** Parsing a message file: front matter inside `---` + body. */
export const parseMessageFile = (raw: string): Message => {
  const lines = raw.split("\n");
  if (lines[0] !== FENCE) {
    throw new MessageFormatError("a message file must start with a '---' line");
  }
  const close = lines.indexOf(FENCE, 1);
  if (close === -1) throw new MessageFormatError("the message header is not closed ('---')");

  const raws = new Map<string, string>();
  for (const line of lines.slice(1, close)) {
    if (line.trim() === "") continue;
    const at = line.indexOf(":");
    if (at === -1) throw new MessageFormatError(`header line without 'key: value': '${line}'`);
    raws.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }

  const from = raws.get("from");
  const date = raws.get("date");
  const expects = raws.get("expects");
  if (!from || !date || !expects) {
    throw new MessageFormatError("'from', 'date' and 'expects' are required in the header");
  }
  if (!ROLE.test(from))
    throw new MessageFormatError(`'from: ${from}' does not look like a role id`);
  if (!DATE_ONLY.test(date) && !TIMESTAMP.test(date)) {
    throw new MessageFormatError(
      `'date: ${date}' — a UTC stamp like 2026-07-23T13:45:12Z is required (or a date for migrated messages)`,
    );
  }
  if (!(EXPECTS as readonly string[]).includes(expects)) {
    throw new MessageFormatError(
      `'expects: ${expects}' — allowed values are ${EXPECTS.join(" | ")}`,
    );
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
    throw new MessageFormatError(`'msg: ${msgRaw}' — the number must be an integer`);
  }
  if (fields.seq !== undefined && !Number.isInteger(fields.seq)) {
    throw new MessageFormatError(`'seq: ${seqRaw}' — the position must be an integer`);
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
 * The file name is the message IDENTIFIER (uniqueness + readability), NOT the
 * ordering key: order inside a thread is set by `compareMessageEntries` via `seq`,
 * not by lexicographic order of names. The name used to be both, and on a
 * non-monotonic date (the merge #27 notification, thread 012) sorting by name
 * reordered a message.
 *
 * New: `2026-07-23T13-45-12Z-dev-core.md` — the colons of the stamp are replaced
 * with hyphens (legal in a name, but unfriendly); a collision is only possible
 * with two messages from one role within the same second.
 *
 * Migrated: `2026-07-21-003-curator.md` — history has no time, only a date and a
 * POSITION (`seq`), NOT the historical number (that one is duplicated). Both
 * formats are distinguishable by eye.
 */
export const messageFileName = (fields: MessageFields): string => {
  if (fields.msg === undefined) return `${fields.date.replaceAll(":", "-")}-${fields.from}.md`;
  if (fields.seq === undefined) {
    throw new MessageFormatError(
      "a migrated message has 'msg' but no 'seq' — the name is built from the position, not from the number",
    );
  }
  return `${fields.date}-${String(fields.seq).padStart(3, "0")}-${fields.from}.md`;
};

/**
 * Message order within a thread. The key is the POSITION (`seq`), not the file
 * name: the name leads with a date, and the date is sometimes non-monotonic with
 * the feed order (writer clock skew, the UTC midnight boundary — the real msg-069
 * in thread 012). `seq` is monotonic by construction of the migration, so it is
 * the source of order.
 *
 * New (post-migration) messages carry no `seq`: they always come AFTER the
 * migrated ones (appended later by definition), and among themselves they order
 * by file name, where the key is correct again: the timestamp is monotonic.
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

/** Section heading in the assembled thread. `number` is a display value: position or historical number. */
export const renderHeading = (fields: MessageFields, number: number): string => {
  const shown = fields.msg ?? number;
  const suffix = fields.suffix === undefined ? "" : ` · ${fields.suffix}`;
  return `## msg-${String(shown).padStart(3, "0")} · from: ${fields.from} · ${fields.date.slice(0, 10)} · expects: ${fields.expects}${suffix}`;
};
