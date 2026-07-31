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

/**
 * WHERE A SECTION REALLY STARTS. A '## msg-' line inside a fenced code block is a
 * QUOTATION, not a heading: the feed quotes tool output verbatim, and the tool
 * that prints headings prints them at the start of the line
 * (`cli thread show | grep '^## msg-'` — 024-scalar-waiting-on/2026-07-29T08-31-53Z-curator.md).
 * The naive `/^## msg-/gm` scan cut a section there and, on the check side, called
 * the quoting message malformed — on an append-only feed that is a validator red by
 * construction over a file nobody may fix (thread 016).
 *
 * The splitter and `check` read fences through THIS function, so the round-trip the
 * check guards ('the assembly would break on it') stays a true statement rather than
 * two independent opinions about the same text.
 */
export const headingOffsets = (raw: string): number[] => {
  const offsets: number[] = [];
  let fenced = false;
  let offset = 0;
  for (const line of raw.split("\n")) {
    if (/^ {0,3}(?:```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && line.startsWith("## msg-")) offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
};

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

  const starts = headingOffsets(raw);

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
 * `undefined` — there is no declaration (the turn was not passed). `null` — there is
 * a declaration but no role was found in it ("—").
 *
 * The legacy prose could name SEVERAL roles in one declaration; since v13 the turn is
 * one role, and the FIRST named is it — in a sequential queue the one written first is
 * the one asked to move. The threads this path reads (009/010) are frozen history.
 */
export const declaredWaitingOn = (
  text: string,
  knownRoles: readonly string[],
): string | null | undefined => {
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
  // Order follows the line, not the role registry: whoever the human wrote first.
  found.sort((a, b) => cleaned.indexOf(a) - cleaned.indexOf(b));
  return found[0] ?? null;
};

/**
 * The thread's current waiting: the LAST declaration, not the field of the last
 * section. The last section very often does not pass the turn (a merge notifier, a
 * follow-up with `expects: none`, a remark without handing over) — reading it
 * literally means zeroing the waiting and leaving a role unwoken.
 *
 * `status: closed` outranks any declaration: a closed thread awaits nobody.
 *
 * `undefined` — nobody holds the turn.
 */
export const waitingOnOf = (thread: Thread): string | undefined => {
  if (thread.meta.status === "closed") return undefined;
  for (let at = thread.messages.length - 1; at >= 0; at--) {
    const declared = thread.messages[at]?.fields.waitingOn;
    if (declared !== undefined) return declared ?? undefined;
  }
  return undefined;
};

/**
 * IS THE TURN FROZEN BEHIND A PERSON, and behind whom (R27) — the `parked-on` of the last
 * message that says anything to anybody.
 *
 * Two rules, and both are the same rule `waitingOnOf` follows, for the same reasons:
 *
 * - the state is carried by the LAST declaration, so it LIFTS BY ITSELF: the next message
 *   that does not repeat `parked-on` is the answer arriving, and nobody has to remember to
 *   unpark anything. This matters more here than for the turn — the session that parked the
 *   thread is dead by then, and a state only a dead session could clear would need a human's
 *   hand every time;
 * - `expects: none` DOES NOT LIFT IT. Those are the informational messages (the merge
 *   notifier, the CI announcement, a follow-up that hands over nothing), and a green run of
 *   somebody's checks is not a person's decision. Reading them literally would unpark the
 *   thread the moment CI reported, which is exactly the wasted raise the state exists to
 *   prevent.
 *
 * `status: closed` outranks it, as it outranks the turn: a closed thread waits for nobody.
 */
export const parkedOnOf = (thread: Thread): string | undefined => {
  if (thread.meta.status === "closed") return undefined;
  for (let at = thread.messages.length - 1; at >= 0; at--) {
    const message = thread.messages[at];
    if (message === undefined || message.fields.expects === "none") continue;
    return message.fields.parkedOn;
  }
  return undefined;
};

/** Date of the last message — the `updated` column of the index. */
export const updatedOf = (thread: Thread): string =>
  thread.messages.at(-1)?.fields.date.slice(0, 10) ?? "—";
