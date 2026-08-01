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

/**
 * Assembling `_thread.md`: the head from `_meta.md` + sections from the messages in
 * file order.
 *
 * `tasks: true` IS FOR THE READER, NEVER FOR THE FILE (thread 021). Task declarations
 * are header fields, and the heading canon prints `from/date/expects` only — it is
 * byte-exact across the live threads, so widening it would rewrite every derived file
 * in the branch (the same argument that kept `worker`/`session` out). So `thread show`
 * turns this on and prints the declarations as a comment under each heading, while
 * `derive` never does and not one committed byte moves.
 */
export const renderThread = (
  meta: ThreadMeta,
  messages: readonly Message[],
  options: { readonly tasks?: boolean } = {},
): string => {
  const head = `# ${meta.title}\n\nparticipants: ${meta.participants.join(", ")} · status: ${meta.status}\n\n`;
  return messages.reduce((acc, message, at) => {
    const heading = renderHeading(message.fields, at + 1);
    const declared = message.fields.tasks ?? [];
    const tasks =
      options.tasks === true && declared.length > 0
        ? `\n\n<!-- tasks: ${declared.map((task) => `${task.id} → ${task.status}`).join(" · ")} -->`
        : "";
    const tail = at + 1 < messages.length ? "\n\n" : "\n";
    return `${acc}${heading}${tasks}\n\n${message.text}${tail}`;
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
 * - THE NEXT MESSAGE LIFTS IT, WHOEVER WROTE IT — no author is examined, and neither is
 *   `expects`. The rule had two narrower shapes before, and each one froze a thread that had
 *   its answer already inside it:
 *
 *   "informational does not lift" cost three (thread 023, live repros 040, 044, 016): a
 *   curator relaying a decision and passing the turn on writes `expects: none` — it asks
 *   nobody for anything — and the thread stayed invisible to the planner until a human's
 *   hand. "An announcement of the circuit does not lift" (`worker: gh-action`) cost 046: the
 *   merge notifier reported the very PR the decision was about, and the park stood for
 *   twelve more hours because the fact came from the circuit rather than from a person.
 *
 *   Both narrowings were an attempt to answer "is this the answer arriving?" from the
 *   header, and the header does not carry that. What it does carry is the only thing the
 *   state actually needs: SOMEBODY WROTE INTO THIS THREAD AFTER THE PARK. The two ways of
 *   being wrong are not equal — lifting too eagerly costs one raise that finds nothing new,
 *   holding too long costs a thread frozen with its answer in it until somebody notices —
 *   and every live incident so far has been of the second kind (thread 023, curator's
 *   measurement of a day: 016, 040, 044, 046, and two more headers repaired by hand).
 *
 *   The author being out of it also settles the DOUBLES question that "the author
 *   discriminates" opened (thread 023): a role writes both from a raised session and from a
 *   human's chat, the two are one `from:` and cannot be told apart in the header — and under
 *   this rule nothing has to tell them apart.
 *
 * THE FIELD IS READ BEFORE THAT SKIP, and the order is the whole of the fix (thread 034,
 * paid for twice with empty sessions): a park DECLARED ON an informational message is still a
 * park. "Informational does not lift" is a statement about a message that says nothing about
 * parking — reading it as "an informational message cannot park either" makes the door's own
 * `--parked-on` silently do nothing, and the pair is raised into a thread that is waiting for
 * a human. The door refuses that combination outright (`--parked-on` with `expects: none`);
 * this order is what makes the ones already lying in the feed act.
 *
 * `status: closed` outranks it, as it outranks the turn: a closed thread waits for nobody.
 */
export const parkedOnOf = (
  thread: Thread,
  mergedElsewhere?: ReadonlySet<number>,
): string | undefined => {
  const parking = parkingOf(thread, mergedElsewhere);
  if (parking === undefined) return undefined;
  return parking.kind === "person" ? parking.person : `pr:${parking.pr}`;
};

/**
 * THE MERGES THE WHOLE MAIL HAS SEEN — the set an event park is judged against (thread 023).
 *
 * A park on `pr:N` lifts when the merge notifier says N has landed, and the notifier writes
 * into the thread named in the DESCRIPTION OF THAT PR — never into the thread that happens to
 * be parked on it. The two are different threads more often than not: 042 parked on `pr:133`
 * while the announcement of 133 went to 046, and 042 stayed frozen with its answer already
 * delivered. Reading the merges of one thread was therefore reading the wrong feed; the mail
 * is one document, and this is the set of PRs it knows to be merged.
 *
 * NO DATE IS COMPARED, unlike the in-thread scan (which gets the ordering for free by walking
 * backwards): a park naming a PR that landed BEFORE it was written is a mistake of the writer,
 * and the two ways of failing are not equal — lifting it costs one raise into a thread whose
 * business is done, holding it costs a thread frozen until a human notices. Same direction the
 * author rule above chose, for the same reason.
 */
export const mergedPrs = (threads: readonly Thread[]): ReadonlySet<number> => {
  const merged = new Set<number>();
  for (const thread of threads) {
    for (const message of thread.messages) {
      const pr = message.fields.mergedPr;
      if (pr !== undefined) merged.add(pr);
    }
  }
  return merged;
};

/** WHAT a raw `parked-on` value names — a person, or the merge of a PR. */
export type ParkedOn =
  | { readonly kind: "person"; readonly person: string }
  | { readonly kind: "event"; readonly pr: number };

/**
 * THE ONE PARSER OF THE FIELD, for every reader that prints a park.
 *
 * The value has two legal forms and they must not be said in the same words: a line calling a
 * merge "a decision of pr:127" sends the reader looking for a participant by that name. Which
 * is a small thing until the phrase is built in more than one place — the first round of this
 * change taught it (reviewer, thread 023): the tick's skip line learned to tell a merge from a
 * person by a regex of its own, and the queue line of the very same state, drawn from the very
 * same map, kept announcing "a decision of pr:127" in the operator's frame and in the daemon's
 * log. The wording of the two lines differs by design — one is a queue row, the other explains
 * a skip — the READING of the field does not, and lives here.
 */
export const parkedOnKind = (raw: string): ParkedOn => {
  const event = /^pr:(\d+)$/.exec(raw);
  return event === null ? { kind: "person", person: raw } : { kind: "event", pr: Number(event[1]) };
};

/**
 * The park with the facts around it: WHO it waits for, SINCE when, and WHAT is being asked.
 *
 * The courier to the human needs all three (thread 023): a notification that names a thread
 * but not the question reads exactly like "the circuit is working", which is what made the
 * digest unreadable — 8 lines of 10 were threads nobody had to touch.
 */
export type Parking = {
  /**
   * WHAT the turn is frozen behind: a PERSON whose decision is wanted, or an EVENT the
   * circuit will see happen (thread 023, variant A of john's decision). The two are one
   * state and differ in exactly one thing — who lifts them — which is why they share the
   * field, and in exactly one more — whether the courier calls a human, which is why the
   * reader has to be able to tell them apart without parsing the value again.
   */
  readonly kind: "person" | "event";
  /** The person of a `kind: "person"` park — the role named in the field. */
  readonly person?: string;
  /** The PR of a `kind: "event"` park: the merge that lifts it. */
  readonly pr?: number;
  /** The stamp of the message that declared it — the identity of the event, not of the thread. */
  readonly since: string;
  /** The first line of the parking message: the question, in the words it was asked in. */
  readonly question: string;
};

/**
 * `mergedElsewhere` — the merges the REST of the mail has announced (`mergedPrs`), because the
 * notifier writes into the PR's own thread and not into the one parked on it. A caller holding
 * the whole scan passes it; one holding a single thread does not have it and does not pretend
 * to — it then reads exactly what this thread saw, which is the old behaviour.
 */
export const parkingOf = (
  thread: Thread,
  mergedElsewhere?: ReadonlySet<number>,
): Parking | undefined => {
  if (thread.meta.status === "closed") return undefined;
  // ONE MESSAGE IS READ, AND IT IS THE LAST ONE: anybody having written after the park is the
  // answer arriving, so a park that is not the newest statement of the feed is already lifted.
  // This used to be a backwards scan over the messages it was allowed to skip — the doc block
  // above names the five live threads that cost.
  const last = thread.messages.at(-1);
  const on = last?.fields.parkedOn;
  if (last === undefined || on === undefined) return undefined;
  const since = last.fields.date;
  const question = questionOf(last.text);
  const named = parkedOnKind(on);
  if (named.kind === "person") return { kind: "person", person: on, since, question };
  const { pr } = named;
  // THE ONE PARK THAT LIFTS WITH NOBODY WRITING AT ALL (thread 023): the merge lands and its
  // notifier writes into the PR's OWN thread, which is not this one. Without this set the park
  // would outlive the merge it waits for, in the one feed that cannot see it.
  if (mergedElsewhere?.has(pr) === true) return undefined;
  return { kind: "event", pr, since, question };
};

/** How wide a question may be before it stops being one line in a phone notification. */
const QUESTION_WIDTH = 140;

/**
 * The one-line question of a parking message: its FIRST non-empty line, stripped of the
 * markup it was written with.
 *
 * No new header field for it, and that is a decision (thread 023): a `question:` beside the
 * body would be a second place to say the same thing, written by the session that is about to
 * die, and the first line of a message asking a person for a decision IS the question in
 * every message that has ever been written here.
 */
export const questionOf = (text: string): string => {
  for (const line of text.split("\n")) {
    const stripped = line
      .replace(/^\s*(?:[#>*+-]+|\d+[.)])\s*/, "")
      .replaceAll(/[*_`]/g, "")
      .trim();
    if (stripped === "") continue;
    return stripped.length > QUESTION_WIDTH
      ? `${stripped.slice(0, QUESTION_WIDTH - 1).trimEnd()}…`
      : stripped;
  }
  return "";
};

/** Date of the last message — the `updated` column of the index. */
export const updatedOf = (thread: Thread): string =>
  thread.messages.at(-1)?.fields.date.slice(0, 10) ?? "—";
