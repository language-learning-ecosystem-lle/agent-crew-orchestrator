/**
 * A thread: the source header (`_meta.md`), the message files and the DERIVED
 * `_thread.md`.
 *
 * THE SOURCE BOUNDARY, which is also the answer to "where does waiting-on live":
 * `_meta.md` is the source only for `title`, `participants` and `status` (edited
 * by curator/john: closing a thread is an acceptance). `waiting-on` lives in the
 * message headers and is NOT duplicated in `_meta.md` — otherwise the field has
 * two writers, exactly the defect that was closed for INDEX in thread 006.
 *
 * BOTH FORMS ARE READ AT ONCE. While the move is in progress, some threads lie as
 * files and some as a single legacy `_thread.md`. The generator handles both:
 * only this way do threads move one at a time and no "switch-over day" exists.
 *
 * THE ASSEMBLY CANON is verified by fact: across 12 live threads (97 sections) the
 * assembly reproduces the existing files BYTE FOR BYTE. That is why the migration
 * has a byte-exact guard rather than a "looks similar" one.
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
  if (lines[0] !== FENCE) throw new MessageFormatError("_meta.md must start with a '---' line");
  const close = lines.indexOf(FENCE, 1);
  if (close === -1) throw new MessageFormatError("_meta.md: the header is not closed ('---')");

  const raws = new Map<string, string>();
  for (const line of lines.slice(1, close)) {
    if (line.trim() === "") continue;
    const at = line.indexOf(":");
    if (at === -1) throw new MessageFormatError(`_meta.md: line without 'key: value': '${line}'`);
    raws.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }

  const title = raws.get("title");
  const participants = raws.get("participants");
  const status = raws.get("status");
  if (!title || !participants || !status) {
    throw new MessageFormatError("_meta.md: 'title', 'participants', 'status' are required");
  }
  if (status !== "open" && status !== "closed") {
    throw new MessageFormatError(
      `_meta.md: 'status: ${status}' — allowed values are open | closed`,
    );
  }

  return { title, participants: parseParticipants(participants), status };
};

export const renderMetaFile = (meta: ThreadMeta): string =>
  `${FENCE}\ntitle: ${meta.title}\nparticipants: ${meta.participants.join(", ")}\nstatus: ${meta.status}\n${FENCE}\n`;

/** Assembling `_thread.md`: the head from `_meta.md` + sections from the messages in file order. */
export const renderThread = (meta: ThreadMeta, messages: readonly Message[]): string => {
  const head = `# ${meta.title}\n\nparticipants: ${meta.participants.join(", ")} · status: ${meta.status}\n\n`;
  return messages.reduce((acc, message, at) => {
    const heading = renderHeading(message.fields, at + 1);
    const tail = at + 1 < messages.length ? "\n\n" : "\n";
    return `${acc}${heading}\n\n${message.text}${tail}`;
  }, head);
};

/**
 * Parsing a SINGLE legacy `_thread.md` — needed both for the migration and for
 * threads that have not moved yet.
 *
 * Sections are cut by offsets rather than by joining lines: joining loses the
 * separating newline between sections, and the byte comparison then lies (caught
 * by a probe before the implementation).
 */
export const parseLegacyThread = (
  id: string,
  raw: string,
  knownRoles: readonly string[],
): Thread => {
  const head = HEAD.exec(raw);
  if (!head?.groups) {
    throw new MessageFormatError(
      `${id}: header not parsed — expected '# title', a blank line and 'participants: … · status: …'`,
    );
  }
  const status = head.groups.status;
  if (status !== "open" && status !== "closed") {
    throw new MessageFormatError(`${id}: 'status: ${status}' — allowed values are open | closed`);
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
    if (!parsed?.groups) throw new MessageFormatError(`${id}: heading not parsed: '${heading}'`);
    const expects = parsed.groups.expects ?? "";
    if (!(EXPECTS as readonly string[]).includes(expects)) {
      throw new MessageFormatError(`${id}: 'expects: ${expects}' in '${heading}'`);
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
 * Declaring who is awaited in the BODY (the legacy form) — the bash generator's
 * rules carried over one to one, including what was learned the hard way:
 *
 * - the arrow must stand immediately after the word (`waiting-on → …`): that is
 *   syntax, not a turn of phrase, otherwise a retelling like "waiting-on stays
 *   with john" is taken for a declaration;
 * - we cut at the LAST `waiting-on`, not at the first arrow: the arrow is a common
 *   character in prose, and parsing from the first one dragged the tail into the
 *   middle of a sentence;
 * - parenthesised explanations are stripped before roles are parsed;
 * - roles are matched by known names rather than by splitting on commas: in live
 *   messages the separator can be a comma, a dash or a conjunction.
 *
 * `undefined` — there is no declaration (the turn was not passed). An empty array
 * — there is a declaration but no roles were found in it ("—").
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
  // Order follows the line, not the role registry: the set is read by a human.
  return found.sort((a, b) => cleaned.indexOf(a) - cleaned.indexOf(b));
};

/**
 * The thread's current waiting: the LAST declaration, not the field of the last
 * section. The last section very often does not pass the turn (a merge notifier, a
 * follow-up with `expects: none`, a remark without handing over) — reading it
 * literally means zeroing the waiting and leaving a role unwoken.
 *
 * `status: closed` outranks any declaration: a closed thread awaits nobody.
 */
export const waitingOnOf = (thread: Thread): readonly string[] => {
  if (thread.meta.status === "closed") return [];
  for (let at = thread.messages.length - 1; at >= 0; at--) {
    const declared = thread.messages[at]?.fields.waitingOn;
    if (declared !== undefined) return declared;
  }
  return [];
};

/** Date of the last message — the `updated` column of the index. */
export const updatedOf = (thread: Thread): string =>
  thread.messages.at(-1)?.fields.date.slice(0, 10) ?? "—";
