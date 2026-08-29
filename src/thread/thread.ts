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

/**
 * THE FORM THE THREAD DECLARES FOR ITS ANSWERS (thread 079). One key, two states:
 * declared (`turn: explicit`) or absent — no space of values, no per-role variants.
 *
 * It exists because the defect it closes is NOT MEASURABLE from the messages. A
 * receiving thread ('the notifier writes, the role reads and leaves') and a working
 * thread ('the role reads the outcome of its own CI and carries on') produce
 * byte-identical messages without `waiting-on`; the three candidate predicates were
 * counted on the live mail (2875 messages) and each refused dozens of LEGAL messages
 * to catch a handful of defects. So the answer is the protocol's usual one for the
 * unmeasurable — a DECLARATION (`waiting-on: —` declares a release, `parked-on`
 * declares a freeze, `--d1` declares a class): the thread says that an answer in it
 * must name who acts next, and the door of `new-message` holds it to that.
 */
export type ThreadTurn = "explicit";

export type ThreadMeta = {
  readonly title: string;
  readonly participants: readonly string[];
  readonly status: ThreadStatus;
  /** Absent on every thread that has not declared it — and that is the majority. */
  readonly turn?: ThreadTurn;
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

  // The key is OPTIONAL and its absence is the ordinary case, so it is read only when
  // it is there — every thread written before 079 stays byte-identical and readable.
  const turn = raws.get("turn");
  if (turn !== undefined && turn !== "explicit") {
    throw new MessageFormatError(
      `_meta.md: 'turn: ${turn}' — the only value is 'explicit' (the key is declared or absent, there is no space of values)`,
    );
  }

  return {
    title,
    participants: parseParticipants(participants),
    status,
    ...(turn === undefined ? {} : { turn: turn as ThreadTurn }),
  };
};

export const renderMetaFile = (meta: ThreadMeta): string =>
  `${FENCE}\ntitle: ${meta.title}\nparticipants: ${meta.participants.join(", ")}\nstatus: ${meta.status}\n${meta.turn === undefined ? "" : `turn: ${meta.turn}\n`}${FENCE}\n`;

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
 * the one asked to move. That multi-role branch is HISTORY THE PARSER STILL HONOURS, not
 * a live shape: it can only come from a legacy thread, i.e. a thread directory WITHOUT
 * `messages/` — and whether this mail has any is a fact measured in the checkout, not a
 * list of numbers to be trusted:
 *
 *     for d in agent-comms/[0-9][0-9][0-9]-*; do [ -d "$d/messages" ] || echo "$d"; done
 *
 * (the glob carries no trailing slash on purpose — that sequence would close this very
 * comment; both forms select the same directories)
 *
 * Empty output — there are none, and no new one can appear (`new-message` refuses to
 * write into a legacy thread, and nobody writes mail files by hand). Measured 2026-08-19,
 * thread `014-merge-model`: empty, all 16 threads carry `messages/`.
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
  if (parking.kind === "person") return parking.person;
  return parking.kind === "run" ? `run:${parking.pr}` : `pr:${parking.pr}`;
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
 * NO DATE IS COMPARED, and since 2026-08-23 (thread 032) the in-thread scan beside it compares
 * none either — it used to, and the two answers to one question differed by which feed the
 * caller happened to hold: a park naming a PR that landed BEFORE it was written is a mistake of the writer,
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

/** WHAT a raw `parked-on` value names — a person, the merge of a PR, or the round running on one. */
export type ParkedOn =
  | { readonly kind: "person"; readonly person: string }
  | { readonly kind: "event"; readonly pr: number }
  | { readonly kind: "run"; readonly pr: number };

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
  if (event !== null) return { kind: "event", pr: Number(event[1]) };
  const run = /^run:(\d+)$/.exec(raw);
  if (run !== null) return { kind: "run", pr: Number(run[1]) };
  return { kind: "person", person: raw };
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
  readonly kind: "person" | "event" | "run";
  /** The person of a `kind: "person"` park — the role named in the field. */
  readonly person?: string;
  /**
   * WHOSE TURN WAS PARKED — the `waiting-on` of the declaring message, and the half of a park
   * that nothing above it carried until thread 042.
   *
   * A park is declared ON A TURN: "I stand here until this person decides". The turn is a PAIR
   * (role × thread) and the park is written on the THREAD, so when the turn moves on to another
   * role the park stays where it was and the new pair inherits a freeze declared about somebody
   * else. Measured on 2026-08-28: a park declared on curator's turn (`12-11-29Z`) stood over the
   * pair `dev-speech×010-speech-service`, whose turn arrived two letters later and had nothing
   * to do with the decision — 4 h 16 m of silence, and the daemon printed `PARKED behind a
   * decision of john` at every tick, a true sentence about the thread and a false one about the
   * pair.
   *
   * Undefined when the declaring message named no `waiting-on` — the reader must then treat the
   * park as covering whoever holds the turn, which is what every reader did before this field.
   */
  readonly holder?: string;
  /** The PR of a `kind: "event"` or `kind: "run"` park: the merge, or the round, that lifts it. */
  readonly pr?: number;
  /** The stamp of the message that declared it — the identity of the event, not of the thread. */
  readonly since: string;
  /** The first line of the parking message: the question, in the words it was asked in. */
  readonly question: string;
  /**
   * WHETHER THE PARKING MESSAGE ASKS ANYTHING OF THE PERSON — the difference between a park
   * that is a QUESTION and a park that is a long-lived STATE (thread 051, john's pain of
   * 2026-08-03: repeated "❓ ждёт твоего решения" about threads where nothing was asked).
   *
   * The freeze is the same in both cases and is read from `kind`/`person`: the turn cannot
   * move, the scheduler skips the thread and the age pass stays quiet about it. What differs
   * is whether a HUMAN IS BEING CALLED, and only the courier cares — `expects: none` says in
   * the author's own words that the message asks nobody for anything, and a ❓ printed over it
   * teaches the reader to ignore the mark, which costs more than a missed call.
   *
   * THE LINE IS `none`, NOT `answer` (curator's decision of 2026-08-03, this thread): a park
   * with `ack` is "I stand until you confirm", which is an action required of the human just
   * the same, so a reader that rang only on `answer` would stay silent about a thread FROZEN
   * AND TELLING NOBODY — the age pass is quiet about parks by rule, the scheduler skips them,
   * and it would stand until somebody happened to read the feed. Noise a reader filters;
   * silence it cannot.
   *
   * `none` therefore stays mute, and it is a park like any other: the door used to refuse it
   * together with `--parked-on` (034) and stopped on 2026-08-04 (decision of john, this
   * thread) — "parks quietly, calls nobody" is the live MODE park of 016 and 052, and after
   * the narrow lift it no longer thaws on the next informational message either.
   */
  readonly asks: boolean;
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
  // ONE WALK, TWO CRITERIA (thread 023 for the event parks, thread 030 for the person one): an
  // event park is looked for BEHIND the messages that move nobody and lifts on the first one
  // that moves somebody; a park on a person lifts on the word of that person (`delivers`) — and,
  // since thread 042, stops covering anything when the TURN it was declared on has ended.
  // `status: closed` outranks both, above.
  const declared = standingParkOf(thread);
  const at = declared === undefined ? undefined : thread.messages[declared];
  const on = at?.fields.parkedOn;
  if (at === undefined || on === undefined) return undefined;
  const since = at.fields.date;
  const question = questionOf(at.text);
  // WHAT THE MESSAGE ITSELF SAYS IT WANTS — carried, not re-decided by the reader: a park is
  // a call to a human unless the message that declared it asks nobody for anything. Both legal
  // parks (`answer` and `ack`) require an action of the person; only `none` is mute.
  const asks = at.fields.expects !== "none";
  const named = parkedOnKind(on);
  // The turn the park was declared on, carried for the readers that print it (`notify.ts` tells
  // a pair the park is ABOUT from one that merely stands in the same thread). Whether the park
  // still covers anything at all is decided one level down, in the walk.
  const holder = at.fields.waitingOn;
  if (named.kind === "person")
    return {
      kind: "person",
      person: on,
      since,
      question,
      asks,
      ...(typeof holder === "string" ? { holder } : {}),
    };
  const { pr } = named;
  // THE PARKS THAT LIFT WITH NOBODY WRITING INTO THIS THREAD AT ALL (thread 023): the merge
  // lands and its notifier writes into the PR's OWN thread, which is not this one. Without this
  // set the park would outlive the merge it waits for, in the one feed that cannot see it. A
  // round is over when its PR is merged too — the verdict it waited for cannot arrive after.
  if (mergedElsewhere?.has(pr) === true) return undefined;
  // The same fact, read from THIS feed, for a caller holding one thread (`mergedElsewhere`
  // is what a whole-mail caller has, and only that one). Both event parks need it since the
  // lift of both became narrow (023): the announcement carrying `merged-pr` asks nobody for
  // anything, so the walk above steps over it, and the merge would go unseen in its own feed.
  //
  // THE WHOLE FEED, NOT THE PART BEHIND THE PARK (thread 032): until 2026-08-23 this scan
  // started one message after the declaration, so an announcement of the very merge being
  // waited for lifted nothing if it happened to lie EARLIER in the same thread — which is
  // exactly the race this thread was opened on, one gap between the snapshot a session reads
  // and the commit of the letter it writes from it. `mergedElsewhere` above has compared no
  // dates since 023 and for the reason written there — a park on a PR that landed before it
  // was declared is a mistake of the writer, and the two ways of being wrong are not equal —
  // and this line was the one place in the same reading that still did. Now the two halves of
  // one question (has the mail seen this merge) answer it the same way, whichever feed the
  // caller happens to hold.
  const merged = thread.messages.some((message) => message.fields.mergedPr === pr);
  if (merged) return undefined;
  return named.kind === "run"
    ? { kind: "run", pr, since, question, asks }
    : { kind: "event", pr, since, question, asks };
};

/**
 * EVERY PERSON-PARK THIS THREAD HAS EVER DECLARED — the one standing and the ones already
 * lifted alike (thread 030, defect (в2)).
 *
 * {@link parkingOf} answers "what is frozen NOW", which is the question the scheduler and the
 * call to the human are made of. The courier has a second one, and it has no other source: a
 * park it ANNOUNCED has vanished from the composition — what was the question, and did it ask
 * anything at all? The state file remembers the pair and the stamp and nothing else (by
 * design: what identifies the event is the message, and the text is re-read from it), so the
 * lifted declaration has to be readable from the feed by that stamp, after the walk of
 * `standingParkOf` has already stepped past it.
 *
 * A CLOSED THREAD DECLARES NOTHING, exactly as in {@link parkingOf}: closing a thread is the
 * acceptance, and a question inside it is answered by construction.
 *
 * `asks` is carried for the same reason it is carried there and for one more: without it the
 * courier cannot tell a lifted QUESTION from a lifted informational park, and a line about the
 * second is the lie by mark that thread 051 paid for.
 */
export const personParksOf = (thread: Thread): readonly Parking[] => {
  if (thread.meta.status === "closed") return [];
  return thread.messages.flatMap((message) => {
    const on = message.fields.parkedOn;
    if (on === undefined || parkedOnKind(on).kind !== "person") return [];
    return [
      {
        kind: "person" as const,
        person: on,
        since: message.fields.date,
        question: questionOf(message.text),
        asks: message.fields.expects !== "none",
      },
    ];
  });
};

/** A stretch of wall-clock time a park on a person held a thread frozen. */
export type ParkSpan = {
  /** Who it was parked on — carried for the reader of a diagnosis, not used to judge. */
  readonly person: string;
  /** The date of the message that DECLARED the park. */
  readonly from: string;
  /** The date of the message that LIFTED it; absent — the park is standing now. */
  readonly to?: string;
};

/**
 * WHEN THIS THREAD WAS FROZEN BEHIND A PERSON, as closed intervals (thread 042, the third
 * false call of the eighth class).
 *
 * {@link parkingOf} answers "is it frozen NOW" and {@link personParksOf} "what was ever
 * declared". Neither answers the question the courier's age needs: FOR HOW LONG was the box
 * unable to raise this pair. Measured in the field on 2026-08-29 (`daemon.log:19561`): john
 * was rung about `curator×042-unaccepted-turn-silent` standing `6h 37m, no reason known` —
 * 6 h 37 m of which were a park on john declared at 03:27:44Z, printed by the box itself on
 * every one of 703 ticks (`⏸ PARKED behind a decision of john`), and lifted at ~10:05Z by
 * `delivers: john`. The pair was raised 39 seconds later. The park is not a reason AFTER it
 * is lifted — nothing in `parkingOf` or in the reasons map says a word about it — so the age
 * fell out of the freeze whole, exactly as the queue of #101 did one породу earlier.
 *
 * THE SPANS ARE READ BY REPLAYING THE FEED, not by a second rule about lifting. Each prefix of
 * the thread is asked the same question the live reader asks — `standingParkOf`, the one walk
 * that knows what declares a park and what lifts it — so a park that ends because its TURN
 * ended (the narrowing of #104) ends here on the same message, and a rule that drifts from the
 * live one cannot be written twice. The cost is a walk per message, on feeds of tens of
 * messages, in a command that already parses the whole mail.
 *
 * A SPAN OPEN AT THE END IS LEFT OPEN (`to` absent): whether "still parked" means "up to now"
 * is the caller's clock, and this function has none.
 */
export const personParkSpansOf = (thread: Thread): readonly ParkSpan[] => {
  if (thread.meta.status === "closed") return [];
  const spans: ParkSpan[] = [];
  let open: { readonly at: number; readonly person: string; readonly from: string } | undefined;
  for (let upto = 0; upto < thread.messages.length; upto += 1) {
    const prefix: Thread = { ...thread, messages: thread.messages.slice(0, upto + 1) };
    const at = standingParkOf(prefix);
    const declaring = at === undefined ? undefined : prefix.messages[at];
    const on = declaring?.fields.parkedOn;
    const standing =
      at === undefined || declaring === undefined || on === undefined
        ? undefined
        : parkedOnKind(on).kind === "person"
          ? { at, person: on, from: declaring.fields.date }
          : undefined;
    // THE MESSAGE THAT ENDED IT IS THE END OF THE SPAN, and the same message may declare the
    // next park: a lift and a re-declaration in one letter is two spans meeting at a point,
    // not one span with a hole in it.
    const now = thread.messages[upto]?.fields.date;
    if (open !== undefined && open.at !== standing?.at && now !== undefined) {
      spans.push({ person: open.person, from: open.from, to: now });
      open = undefined;
    }
    if (standing !== undefined && open === undefined) open = standing;
  }
  if (open !== undefined) spans.push({ person: open.person, from: open.from });
  return spans;
};

/**
 * WHERE A PARK STILL STANDS — the index of the message that declared it. ONE WALK, and since
 * 2026-08-22 TWO CRITERIA in it: the event parks (`pr:`, `run:`) lift on the first message that
 * MOVES ANYBODY, and the park on a PERSON lifts on `delivers: <that person>`. The walk therefore
 * no longer stops at a moving message — it remembers it, because behind that message there may
 * stand a park the message does not touch.
 *
 * SINCE 2026-08-29 THE PERSON PARK IS ALSO READ AGAINST THE TURN IT WAS DECLARED ON (thread 042,
 * decision of john, `PROTOCOL.md` "ПАРКОВКА НА ЧЕЛОВЕКЕ ОБЪЯВЛЯЕТСЯ НА ХОД, А НЕ НА ТРЕД
 * НАВСЕГДА"). The narrowing of 22.08 said WHAT lifts a park and never said WHAT IT WAS SET ON,
 * so `parked-on` stayed a property of the THREAD and outlived the turn it was declared for. The
 * park is now the pair "holder × thread", the holder being the `waiting-on` of the declaring
 * message, and a NEW TURN does not inherit it: a later `waiting-on` naming another role ends it,
 * and so does an outcome handed to the same holder without a question in it. A park whose
 * message declared no holder is untouched by all of this — see the walk itself.
 *
 * WHY THE PERSON PARK LEFT THE COMMON WALK (thread 030, defect (в1), decision of john
 * 2026-08-22, `PROTOCOL.md`). The wide lift was defended by an ASYMMETRY of the price: lifting
 * early cost one empty raise, not lifting cost a thread frozen with the answer already inside it
 * until a human noticed (046 stood 12 hours). Thread 030 closed the expensive half by
 * measurement — a standing park with an unanswered question is counted and RINGS (`N parked, K
 * of them asking`), and one that has been lifted goes into the digest as a line instead
 * of vanishing from the composition — so the narrowing now pays that price instead: a forgotten
 * `delivers` is read by the human in the NEXT digest, not half a day later. What it buys is the
 * defect the wide lift kept producing: the park was lifted by the class of messages it was set
 * against — the circuit's own trace and the role's own report — and the raise it bought found a
 * thread still waiting for the person.
 *
 * The delivery has to be a FIELD: a person does not write into the mail, their word arrives in a
 * letter of a courier role, and "has the answer come" does not follow from `from`/`expects`/
 * `waiting-on` at all, while reading it out of the body is forbidden to this net by the norm of
 * 020. Narrowing to `from:` of the parker instead was considered and rejected — it lifts the
 * park on the role's own echo, which repairs one half and leaves the other silent.
 *
 * Everything below describes the walk of the EVENT parks, which is unchanged.
 *
 * The walk exists because the circuit announces its OWN events (`from: github`,
 * `expects: none`) about the very thing being waited for, and they are not the thing being
 * waited for. It happened live within minutes of the form being proposed (thread 019,
 * 2026-08-02): the park of 09:12:57Z was lifted at 09:15:07Z by "CI по PR #163 — success", the
 * pair was raised at 09:16:13Z, the door refused it because the review round still had twelve
 * minutes to run, and the session had nothing to do. The `pr:` park was narrowed to the same
 * walk for the same reason, one thread later (023, curator's statement of 2026-08-03): a turn
 * frozen behind a merge button is not released by the circuit reporting some other PR's
 * outcome, and the raise it bought found nothing to do.
 *
 * THE PERSON PARK JOINED THEM LAST, and it was measured too (023, decision of john
 * 2026-08-04). The wide lift used to be defended as the safety against a thread frozen behind a
 * human forever; on 2026-08-03 the safety fired at its own circuit — the park on john was
 * lifted by the merge notifier of #192 (`from: github`, `expects: none`, no `waiting-on`),
 * announcing a merge curator had pressed herself three minutes earlier. It bought an empty
 * curator session and a gap of THREE SECONDS between that raise and the `restart` button the
 * raise then held up (`023-daemon-parallelism/messages/2026-08-03T19-57-08Z-curator.md` §1).
 * From that day until 2026-08-22 all three kinds had ONE criterion of lifting, on the reading
 * that the courier of a decision moves somebody by construction — it either names who acts on it
 * (`waiting-on: <role>`) or asks for something (`expects` != none). What that reading could not
 * tell apart is the courier from anybody ELSE holding a turn, and thread 030 measured the cost;
 * the person park is now lifted by the courier SAYING SO (`delivers`), and the paragraphs below
 * describe the walk the event parks kept.
 *
 * So the walk backwards is over the messages that MOVE NOBODY, and stops at the first message
 * that does. Two things move somebody, and the header carries both:
 *
 * - `expects != none` — the message asks somebody for something: the verdict, and every other
 *   kind of answer;
 * - `waiting-on: <role>` DECLARED with a role in it — the message hands the turn over without
 *   asking anything. This is the ACTIONABLE CI OUTCOME (thread 048, form (б)): the notifier
 *   names the role on `failure`/`timed_out`/`startup_failure`/`action_required` and leaves the
 *   field out entirely on the trace class (`success`, `cancelled`, …). The distinction is
 *   therefore read where the notifier already writes it, and no body text is parsed.
 *
 *   It cost 3.5 hours of a dead pair to learn (thread 023, 2026-08-03): the `failure` of #177
 *   was delivered at 06:23:44Z into a thread parked on `run:177`, the park did not lift, the
 *   role held its turn with an actionable red in front of it, and the silence was noticed by a
 *   human at 09:40Z.
 *
 *   The trace class has EXACTLY ONE exception, and it is about an ACTION rather than an outcome
 *   (thread 023, 2026-08-03, decision of john): a green `checks` on a PR that does NOT yet carry
 *   the `review` label names the AUTHOR's role, because the norm of 03.08 puts that label up
 *   AFTER a green `checks` on the same head — the author has exactly one move there and it is
 *   theirs. It reaches this walk the same way every handover does, through `waiting-on: <role>`
 *   in the header, so nothing here changes. Everything else green stays silent: a PR that
 *   ALREADY carries the label (the round is running — case 048), the outcome of a PREVIOUS head,
 *   and a run without the `checks` job. The trace of a round ALREADY RUNNING therefore lifts
 *   nothing, exactly as it did — that is the case the narrow form was built for.
 *
 * A declared NULL (`waiting-on: —`) is not a handover: it zeroes the holder of the turn and
 * moves the thread to nobody, so it is skipped like any other announcement.
 */
const standingParkOf = (thread: Thread): number | undefined => {
  // What the walk has seen SINCE the park it is about to find — the facts the lifts are made of.
  // They are collected on the way down and read at the park, because which of them applies is
  // known only when the kind of the park is: the same message lifts an event park and leaves a
  // person park standing.
  let moved = false;
  const delivered = new Set<string>();
  // THE TURNS OPENED SINCE (thread 042): every role a later message HANDED THE TURN TO, and the
  // ones it handed it to WITHOUT ASKING FOR ANYTHING. The first set answers "did the turn the
  // park was declared on end", the second "did the turn it was declared on get its outcome".
  const handedTo = new Set<string>();
  const outcomeFor = new Set<string>();
  for (let at = thread.messages.length - 1; at >= 0; at -= 1) {
    const message = thread.messages[at];
    if (message === undefined) return undefined;
    // THE FIELD IS READ BEFORE THE SKIP, as it is above (thread 034): a park declared on an
    // informational message is still a park — and here the message declaring one is itself a
    // legal step of the walk, so the order is what keeps it from being walked over.
    const on = message.fields.parkedOn;
    if (on !== undefined) {
      const named = parkedOnKind(on);
      if (named.kind === "person") {
        // THE PERSON PARK LIFTS ON THE WORD OF THAT PERSON (thread 030, defect (в1), decision of
        // john 2026-08-22): `delivers: <the same person>`, said by whoever carries the word. A
        // park on somebody else is not lifted by it — the state names one person, and so does
        // the delivery. This one lifts the park for the whole thread, whoever holds the turn.
        if (delivered.has(named.person)) return undefined;
        const holder = message.fields.waitingOn;
        // A PARK THAT NAMES NO TURN KEEPS ITS POWER OVER THE WHOLE THREAD (thread 042): the feed
        // does not say whose turn it was declared on — a declared NULL zeroes the holder and an
        // absent field inherits one written elsewhere — and guessing would turn the legitimate
        // MODE park (016, 052) into a raise. This is the pre-042 park, and it behaves as it did.
        if (typeof holder !== "string") return at;
        // THE PARK IS ON A TURN, AND A NEW TURN DOES NOT INHERIT IT (thread 042, decision of john
        // 2026-08-29, `PROTOCOL.md`): a later message naming somebody ELSE in `waiting-on` ended
        // the turn the park was declared on, and the pair that holds the thread now is not
        // waiting for a human — it is waiting to be raised. Measured in LLE on 2026-08-28: a
        // park declared on curator's turn stood over `dev-speech×010-speech-service` for
        // 4 h 16 m, with 201 ticks of `PARKED behind a decision of john` — true about the thread
        // and false about the pair. The turn coming BACK to the same role later does not revive
        // it either: that is a third turn, not the parked one, which is why this is a set of
        // everything seen and not the last handover alone.
        for (const to of handedTo) if (to !== holder) return undefined;
        // AND AT THE SAME HOLDER, THE ACTIONABLE OUTCOME OPENS ONE TOO (same norm, second half):
        // a message that hands the turn over WITHOUT asking anything is the circuit's outcome —
        // the red CI, and the green `checks` on a PR that does not yet carry the `review` label
        // — the same class the event parks lift on, read from the same two header fields. What
        // it is NOT is the class the narrowing of 22.08 bought: the role's own report asks
        // (`expects` != none) and the trace of the circuit (`success` echo, merge-notify) hands
        // the turn to nobody, so neither says the wait is over.
        //
        // THE THIRD MEMBER OF THE LIST — THE REVIEWER'S VERDICT — reaches this walk since
        // 2026-08-29 (decision of john, thread 042, `PROTOCOL.md` "ПУНКТ (ii) ПОЛУЧАЕТ ЧИТАЕМЫЙ
        // ПРИЗНАК"), and it needed a sign of its own because by `expects`/`waiting-on` alone it is
        // a letter of a role with `expects: answer`, indistinguishable from a report. The sign is
        // the DECLARED PAIR `verdict:`/`pr:` in the header — the sender's role is deliberately
        // NOT read against the config — so no body text is parsed here either, and a letter
        // written before the fields existed carries none and opens nothing, exactly as it did.
        return outcomeFor.has(holder) ? undefined : at;
      }
      // The event parks keep the walk exactly as it was: they wait for a machine event, and the
      // first message that MOVES anybody says the wait is over.
      return moved ? undefined : at;
    }
    const delivers = message.fields.delivers;
    if (delivers !== undefined) delivered.add(delivers);
    const waitingOn = message.fields.waitingOn;
    if (typeof waitingOn === "string") {
      handedTo.add(waitingOn);
      // The outcome is stated in one of two ways, and both are header fields: the circuit hands
      // the turn over without asking anything (`expects: none`), or a message DECLARES the
      // verdict of a round (thread 042). The verdict's own `expects` is `answer` and stays that:
      // the reviewer asks the author for fixes or curator for the button, and the norm of
      // `REVIEWER.md` does not move a line — what the pair adds is the OUTCOME being readable.
      if (message.fields.expects === "none" || declaresVerdict(message)) outcomeFor.add(waitingOn);
    }
    // The walk does not stop here any more, it REMEMBERS: a message that moves somebody lifts an
    // event park, and behind it there may still stand a park on a person that it does not touch.
    if (movesSomebody(message)) moved = true;
  }
  return undefined;
};

/**
 * Does this message DECLARE the verdict of a review round (thread 042)? Both halves are demanded
 * here as they are at the writing door: the reader drops a lone half, and a walk that accepted
 * one would open a turn on a header the feed does not actually carry.
 */
const declaresVerdict = (message: Message): boolean =>
  message.fields.verdict !== undefined && message.fields.pr !== undefined;

/** Does this message move anybody — by asking, or by naming whose turn it now is? */
const movesSomebody = (message: Message): boolean =>
  message.fields.expects !== "none" || typeof message.fields.waitingOn === "string";

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
