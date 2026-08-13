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
 *
 * PROVENANCE (`worker`, `session` — R7, thread `016-protocol-roadmap`). `from` says
 * WHICH ROLE spoke; it says nothing about WHAT WROTE the text, and the two are not
 * the same question. A role is a long-lived participant of the conversation, while a
 * session is a run with a beginning and an end — and the norm the fields make
 * legible is this: ONE ROLE WRITES INTO ONE THREAD FROM MANY SESSIONS. Two adjacent
 * messages from `dev-core` are as likely as not to have been written by two runs
 * that share nothing but the role card: the second one knows what is IN THE THREAD
 * and nothing else. Read without that, the feed looks like one continuous
 * interlocutor, and "as I said above" starts to mean something it does not.
 *
 * `worker` is an OPEN vocabulary (`claude-code`, `claude-ai`, `gh-action`, `human`,
 * `agent-protocol`, `unknown`, and whatever tool comes next), validated by SHAPE and
 * not by a list. A closed enum would make every new tool in the ecosystem a schema
 * migration of the protocol — and which tools exist is not the protocol's business.
 */

/**
 * THE LAUNCH DIRECTIVE (R21, john's decision, thread `016-protocol-roadmap`) — an
 * authorized role saying which model and effort the RUNS OF THIS THREAD are to be
 * raised with, from here on.
 *
 * WHY IN A MESSAGE AND NOT IN `_meta.md`. The fork was weighed by john and settled
 * for the message: `_meta.md` would be a second source of truth outside the feed and
 * a mutable file two writers edit, while a header field lives in the append-only
 * feed, where the audit is free — WHO changed it and WHEN is the message itself. It
 * also matches how a thread actually behaves: it lives for days across phases, so
 * "the last directive of an authorized role wins" covers both the steady case (one
 * directive in the statement of work) and a change mid-thread.
 *
 * WHY THE VALUES ARE NOT VALIDATED HERE, only their shape. The vocabulary of
 * `effort` belongs to one tool (`claude-code`), and a parser that rejected an
 * unknown level would make a message written by a future writer unreadable — that
 * is, it would break the whole THREAD, not the one directive. So the door of the
 * writer (`new-message`) validates against the agent config and refuses there, and
 * the resolution (`orchestrator/directive.ts`) ignores-with-announcement whatever
 * still got in. Both are recoverable; an unparseable feed is not.
 */
export type LaunchDirective = {
  /** `--model` of the raised tool: an alias (`opus`, `sonnet`) or a full name. */
  readonly model?: string;
  /** `--effort`: the level, in the raised tool's own vocabulary. */
  readonly effort?: string;
};

/**
 * THE PRIORITY OF A THREAD (R5, thread `016-protocol-roadmap`) — an authorized role
 * saying which of the waiting threads the orchestrator raises first, from here on.
 *
 * It is a header field for the same reason the launch directive is (and the argument
 * is stronger, see `orchestrator/priority.ts`): importance is a statement about the
 * moment, the feed is append-only, and a later statement supersedes an earlier one
 * without anybody editing a mutable file.
 *
 * UNLIKE `launch`, THE VALUES ARE VALIDATED HERE. The vocabulary of `effort` belongs
 * to a foreign tool, so a strict parser would make a message written by a future
 * writer unreadable; `high | normal | low` is the PROTOCOL's own vocabulary — the same
 * class as `expects` — and there is no future writer who could legitimately widen it
 * without a schema version.
 */
export const THREAD_PRIORITY_VALUES = ["high", "normal", "low"] as const;
export type ThreadPriorityValue = (typeof THREAD_PRIORITY_VALUES)[number];

/**
 * A TASK DECLARATION (thread `021-native-tasks`) — the one markup by which work is
 * announced and moved. The board (`TASKS.md`) is DERIVED from these; there is no
 * editable registry, because a second editable source drifts from the feed by
 * construction — the same argument that made INDEX derived in thread 006.
 *
 * WHY A HEADER FIELD AND NOT A MARKED-UP SECTION OF THE BODY. The precedent is
 * `waiting-on` (pain 2: a declaration lost in prose is a silent drop), but the
 * carrying argument is stronger and checks itself on the statements of work in this
 * very thread: the BODY IS FREE TEXT BY CONTRACT, and a statement of work QUOTES the
 * markup while proposing it. Were the markup a body block, the proposal itself would
 * have opened half a dozen tasks that do not exist — and an append-only feed has
 * nothing to repair that with. In the header a quote is inert by construction.
 *
 * THE PRICE, named rather than discovered: the field is not visible in the assembled
 * `_thread.md`, because `renderHeading` prints `from/date/expects` only and the
 * assembly canon is byte-exact across the live threads (the same reason `worker` and
 * `session` deliberately never reached a derived file). `thread show` prints the
 * declarations under the heading of each message for the reading agent; `derive` never
 * does, so not one byte of a committed derived file moves.
 *
 * `NNN.k`, NOT A RUNNING NUMBER. A running counter needs an allocator, and an
 * append-only file feed has none: two threads in one minute would mint the same id —
 * which is exactly why the message number stopped being an identifier (`msg-005`
 * collided twice in 012 as a matter of fact). `NNN.k` is minted LOCALLY by the owning
 * thread, is conflict-free by construction, and localises itself: `021.2` pasted into a
 * chat says where to look.
 */
export const TASK_STATUS_VALUES = ["open", "in-progress", "done", "dropped"] as const;
export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];

/**
 * The statuses from which nothing moves on by itself. `done` is NOT one of them:
 * `done → in-progress` is allowed, because a PR gets reverted and a review hands work
 * back — forbidding it would only force a fake new id. `dropped` IS terminal: a task
 * taken off the board comes back as a new id, not as a resurrection.
 */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ["done", "dropped"];

export type TaskDeclaration = {
  /** `NNN.k` — the thread that minted it, and the ordinal inside that thread. */
  readonly id: string;
  readonly status: TaskStatus;
  /**
   * The tail after ` · `: the TITLE on `open`, the FACT on `done`/`dropped` (a PR, a
   * commit, a decision), a free note on `in-progress`. Required everywhere except
   * `in-progress` — "done in the normal case comes with a fact" is made checkable
   * rather than left as a wish, so an empty `done` stops slipping through by inertia.
   */
  readonly tail?: string;
};

const TASK_ID = /^\d{3,}\.\d+$/;
/** The separator of the tail. A space-dot-space, not a comma: a title contains commas. */
const TASK_TAIL = " · ";

/** The thread a task id belongs to — the `NNN` of `NNN.k`, matched against a thread id `NNN-slug`. */
export const taskThreadPrefix = (id: string): string => id.slice(0, id.indexOf("."));

export const parseTaskDeclaration = (value: string): TaskDeclaration => {
  const at = value.indexOf(TASK_TAIL);
  const head = (at === -1 ? value : value.slice(0, at)).trim();
  const tailRaw = at === -1 ? undefined : value.slice(at + TASK_TAIL.length).trim();
  const tokens = head.split(/\s+/).filter((token) => token !== "");
  if (tokens.length !== 2) {
    throw new MessageFormatError(
      `'task: ${value}' — the form is 'task: <NNN.k> <${TASK_STATUS_VALUES.join("|")}>[ · tail]'`,
    );
  }
  const [id, status] = tokens as [string, string];
  if (!TASK_ID.test(id)) {
    throw new MessageFormatError(
      `'task: ${value}' — the id is 'NNN.k' (the owning thread and an ordinal inside it), for example '021.2'`,
    );
  }
  if (!(TASK_STATUS_VALUES as readonly string[]).includes(status)) {
    throw new MessageFormatError(
      `'task: ${value}' — allowed statuses are ${TASK_STATUS_VALUES.join(" | ")}`,
    );
  }
  if (tailRaw === "") {
    throw new MessageFormatError(`'task: ${value}' — the tail after ' · ' is empty`);
  }
  if (tailRaw === undefined && status !== "in-progress") {
    throw new MessageFormatError(
      status === "open"
        ? `'task: ${value}' — an opened task needs a title: 'task: ${id} open · what it is'`
        : `'task: ${value}' — a '${status}' needs the FACT that closes it: 'task: ${id} ${status} · PR #48' (a PR, a commit or a message of a thread)`,
    );
  }
  return { id, status: status as TaskStatus, ...(tailRaw === undefined ? {} : { tail: tailRaw }) };
};

export const renderTaskDeclaration = (task: TaskDeclaration): string =>
  `${task.id} ${task.status}${task.tail === undefined ? "" : `${TASK_TAIL}${task.tail}`}`;

/**
 * The header keys that may appear MORE THAN ONCE — an explicit list, because the
 * parser folded the header into a map and a duplicate key overwrote its predecessor
 * SILENTLY. One message declares and moves several tasks, so `task` has to repeat; and
 * the moment it may, the silence around every other key stops being tolerable — a
 * second `from` would have quietly won over the first. Proven not to break anything
 * that exists: 511 message files on the live branch, zero duplicate keys.
 */
export const REPEATABLE_HEADER_KEYS: readonly string[] = ["task"];

/** `expects` — what the author awaits: a substantive answer, an acknowledgement or nothing. */
export const EXPECTS = ["answer", "ack", "none"] as const;
export type Expects = (typeof EXPECTS)[number];

/**
 * The worker values in use here. NOT a validation list (see the doc block) — it is
 * what the CLI names in its refusals, so that whoever has to pass `--worker` is told
 * what the neighbours use instead of being left to invent a spelling.
 */
export const KNOWN_WORKERS = [
  /** A `claude-code` session — a raised one or a hand-run one. */
  "claude-code",
  /** The chat side (a role that lives inside a claude.ai conversation). */
  "claude-ai",
  /** A GitHub Actions job (the reviewer, the merge notifier). */
  "gh-action",
  /** A person, writing by hand. */
  "human",
  /** The package itself: a message composed by a command (the force-stop announcement). */
  "agent-protocol",
  /** Provenance WAS NOT RECORDED — the value the migration to version 2 stamps history with. */
  "unknown",
] as const;

/** What the schema migration writes into messages that predate provenance. */
export const WORKER_UNRECORDED = "unknown";

/** What the package puts on a message it composed itself (the force-stop announcement). */
export const PACKAGE_WORKER = "agent-protocol";

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
  /**
   * WHAT wrote the message (`claude-code`, `gh-action`, `human`, …) as opposed to
   * WHO said it (`from`). Absent in messages written before provenance existed and
   * in legacy threads assembled out of `_thread.md`; `unknown` where the migration
   * stated that absence explicitly.
   */
  readonly worker?: string;
  /**
   * The id of the RUN that wrote it — the identity that tells two messages of one
   * role apart when they came from two sessions. Absent wherever there is no such
   * thing (a human, a chat) or where the run could not name itself.
   */
  readonly session?: string;
  /** New ones — a UTC stamp `2026-07-23T13:45:12Z`; migrated ones — a date only. */
  readonly date: string;
  readonly expects: Expects;
  /**
   * WHOSE TURN IT IS — EXACTLY ONE role or nobody (v13). A missing field means "I am
   * not passing the turn" (the previous holder is inherited), `null` (`—` on the wire)
   * means the waiting is lifted.
   *
   * IT USED TO BE A SET, and the set was the defect: the field is written WHOLE, so
   * whoever answered rewrote somebody else's waiting along with their own (a thread
   * awaited `dev-core, john`; dev-core replied `waiting-on: curator` and john's
   * unclosed turn silently evaporated). The cases that looked like two independent
   * waits are not turns at all — they are tasks with owners; the feed's queue is
   * strictly sequential (dev → reviewer → dev → … → curator). As a scalar it also
   * closes the second defect by construction: the daemon has nobody to raise second
   * on one thread.
   */
  readonly waitingOn?: string | null;
  /**
   * WITH WHAT THE RUNS OF THIS THREAD ARE TO BE RAISED from here on (R21). Effective
   * only from a role holding `launch-params`; from anyone else it is ignored OUT LOUD
   * at the moment a candidate is chosen, never silently.
   */
  readonly launch?: LaunchDirective;
  /**
   * WHICH WAITING THREAD IS RAISED FIRST from here on (R5). Effective only from a role
   * holding `thread-priority`; from anyone else it is ignored OUT LOUD when the queue
   * is built, never silently. Absent means the thread keeps the default (`normal`).
   */
  readonly priority?: ThreadPriorityValue;
  /**
   * WHOSE DECISION THE TURN IS PARKED BEHIND — a person, and only a person (R27).
   *
   * v13 made `waiting-on` scalar and refused `john` in it for a good reason: the turn is
   * held by somebody who can be RAISED, and a human is not raised by the daemon. What that
   * left unsayable is the other half of the same situation: the role holds the turn and can
   * do nothing at all until a human decides. Said in no field, it was read by the orchestrator
   * as ordinary mail — the pair was raised, the session found the question still unanswered,
   * wrote nothing new and died, and three of those exhausted the pair for doing exactly what
   * the norm prescribes.
   *
   * So this is not a second `waiting-on`: the turn stays where it is (a scalar, one holder),
   * and this field says that it is FROZEN. The state lifts by itself — the first substantive
   * message after it (see `parkedOnOf`) is the answer arriving, whoever relays it.
   *
   * Only a role that wakes ITSELF (`wake.mode: 'self'`) may be named here; a role the daemon
   * can raise is not something to park behind — that is `waiting-on`.
   */
  readonly parkedOn?: string;
  /**
   * THE MERGE THIS MESSAGE ANNOUNCES (thread 023) — the number of a PR that has just landed
   * in the default branch. Written by the merge notifier, read by `parkingOf`: a thread
   * parked on `pr:<n>` lifts on the message that says this number, and on nothing else.
   *
   * A field rather than a phrase in the body, because the body of that notification is prose
   * for a human and a park that lifts by pattern-matching prose is a park that one day does
   * not lift. It is the only fact of the message that the reader of an append-only feed has
   * to be able to trust.
   */
  readonly mergedPr?: number;
  /**
   * TASKS DECLARED OR MOVED by this message (thread 021) — the one source the board is
   * derived from. Repeatable: one message opens and moves several at once.
   */
  readonly tasks?: readonly TaskDeclaration[];
  /** Heading tail from history (`· [СВЕРХПИСАНО msg-002]`, quoted verbatim from live data), so the assembly matches byte for byte. */
  readonly suffix?: string;
};

export type Message = {
  readonly fields: MessageFields;
  /** Body without the surrounding blank lines: the assembly places those. */
  readonly text: string;
  /**
   * WHAT THIS READER COULD NOT MAKE SENSE OF IN THE HEADER, field by field (thread 023).
   *
   * A message is not all-or-nothing: the four fields that decide WHOSE TURN IT IS (`from`,
   * `date`, `expects`, `waiting-on`) still refuse the file, because a thread answering "whose
   * turn" from a stale message is the silent staleness this package exists to remove. The rest
   * — provenance, a park, a priority, a launch directive, a task line — are DROPPED with the
   * reason recorded here, and the message is read.
   *
   * The class this is for is a PERPETUAL one: an old reader meeting a new field of the schema.
   * It happened live (a daemon raised at 15:15Z read `parked-on: pr:133` written at 16:18Z by
   * code that landed at 16:10Z) and it will happen at every next field, because the readers of
   * a running circuit are processes started at different times. The cost of refusing was the
   * WHOLE thread going unreadable to the planner over one field nobody needs to plan with.
   */
  readonly warnings?: readonly string[];
  /**
   * WHAT THIS READER ACCEPTED IN A SPELLING THAT IS NOT THE CANON (thread 065, variant (iv)).
   *
   * The counterpart of `warnings` and deliberately a SECOND channel: nothing was dropped here
   * and the thread is complete — one value was written another way and read as the value it
   * plainly is. Saying that under "the field was DROPPED" would be false about the feed.
   *
   * Tolerance without a voice is the failure this is built against: `2026-08-13T17-28-50Z` in
   * the header of a hand-written message (thread 066, live on 2026-08-13) made the WHOLE thread
   * unreadable, and the refusal became visible only after another one before it was fixed. The
   * cure is to read it — and to say, every time it is read, that the file on disk is off-canon,
   * because nothing else will: the feed is append-only, so the byte stays there forever.
   */
  readonly notices?: readonly string[];
};

const FENCE = "---";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/**
 * THE FILE-NAME SPELLING OF THE SAME MOMENT: `2026-08-13T17-28-50Z`. Not another value —
 * the colons of the stamp written as the hyphens `messageFileName` puts in a name (they
 * are legal in a name, the colons are unfriendly there). A hand that copies the name into
 * the header produces exactly this, and it happened twice in one day.
 */
const FILENAME_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/;
const ROLE = /^[a-z][a-z0-9-]*$/;

/**
 * THE OTHER THING A TURN CAN BE FROZEN BEHIND: an EVENT (thread 023, variant A of john's
 * decision) — today two of them, both about one pull request and told apart by WHAT THEY WAIT
 * FOR: `pr:127` waits for the BUTTON (the merge, lifted by the notifier's `merged-pr`), and
 * `run:127` waits for the VERDICT of the round running on it (lifted by the first message that
 * asks anybody for anything).
 *
 * The prefix the day this opened was said to keep the door open for a second kind of event
 * without promising one; thread 019 walked through it. The measurement that decided it (curator,
 * 2026-08-02): four raises of one pair in a morning, three of which could do nothing but look at
 * a review round that was still running — $4.79 of waiting against $1.64 of work. Neither
 * existing form says it. `pr:` claims the decision is made and only a hand is missing, and a
 * person claims a human is deciding at all — the machine is.
 *
 * A namespaced token rather than a bare number, and rather than a second field beside
 * `parked-on`: the parks are the same state (the turn is here and cannot move) and differ
 * only in what releases them, so they belong in one field a reader can answer "what is this
 * waiting for?" from. A role id can never collide with it, and nothing has to be renamed
 * the day a third thing becomes observable to the circuit.
 */
const PARK_EVENT = /^pr:(?:\d+)$|^run:(?:\d+)$/;
/** The shape of a worker id — the same one a role id has: an open vocabulary, a fixed spelling. */
const WORKER = /^[a-z][a-z0-9-]*$/;
/**
 * The shape of a session id. Deliberately WIDE: the id is minted by somebody else's
 * runtime (a uuid today, whatever `cursor` mints tomorrow), so all this checks is
 * that it is one printable token which can be grepped for and pasted back — a value
 * with a space or a newline in it would break both the header and the search.
 */
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * The same two checks the parser applies, exported for the WRITING side: a value
 * that would not parse must be refused at the door with the flag in hand, not
 * discovered later by a reader who cannot fix it (the feed is append-only).
 */
export const isWorkerId = (value: string): boolean => WORKER.test(value);
export const isSessionId = (value: string): boolean => SESSION.test(value);

/**
 * The keys a launch directive may carry. A CLOSED list, unlike the worker vocabulary:
 * an unknown key here is a typo whose only possible outcome is a run raised with
 * settings nobody chose (`modell: opus` would resolve to "nothing was said"), and that
 * is the exact failure R15 named and R21 inherits.
 */
export const LAUNCH_DIRECTIVE_KEYS = ["model", "effort"] as const;

/** The shape of a directive value: one printable token, so `k=v, k=v` stays parseable. */
const DIRECTIVE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/**
 * `launch: model=sonnet, effort=high` → the directive. The pair form (rather than two
 * header fields) keeps the directive ONE atom: it is written, read and superseded as
 * a whole, and "who last said what to raise this thread with" has one answer per
 * message rather than two that can disagree.
 */
export const parseLaunchDirective = (value: string): LaunchDirective => {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) {
    throw new MessageFormatError(
      `'launch:' is empty — say at least one of ${LAUNCH_DIRECTIVE_KEYS.join(", ")} (as 'model=sonnet, effort=high') or leave the field out`,
    );
  }
  const directive: { model?: string; effort?: string } = {};
  for (const part of parts) {
    const at = part.indexOf("=");
    const key = at === -1 ? part : part.slice(0, at).trim();
    const raw = at === -1 ? "" : part.slice(at + 1).trim();
    if (!(LAUNCH_DIRECTIVE_KEYS as readonly string[]).includes(key)) {
      throw new MessageFormatError(
        `'launch: … ${part}' — the known keys are ${LAUNCH_DIRECTIVE_KEYS.join(", ")} (written as 'key=value')`,
      );
    }
    if (!DIRECTIVE_VALUE.test(raw)) {
      throw new MessageFormatError(
        `'launch: … ${part}' — the value must be one printable token without spaces`,
      );
    }
    if (directive[key as "model" | "effort"] !== undefined) {
      throw new MessageFormatError(`'launch: … ${key}' is given twice`);
    }
    directive[key as "model" | "effort"] = raw;
  }
  return directive;
};

export const renderLaunchDirective = (directive: LaunchDirective): string =>
  LAUNCH_DIRECTIVE_KEYS.flatMap((key) => {
    const value = directive[key];
    return value === undefined ? [] : [`${key}=${value}`];
  }).join(", ");

export class MessageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageFormatError";
  }
}

/**
 * THE BODY CLAIMING THE TURN IS RELEASED — the two forms the door reads, and it
 * reads them ONLY to refuse the message, never to believe them (thread 042).
 *
 * The header stays the single source of the turn: this is not `waiting-on` parsed out
 * of prose again (pain 2), it is the contradiction between what a message SAYS about
 * its own header and what the header carries. On 2026-08-05 two messages in a row —
 * curator's and dev-core's — wrote "ход снимаю полем `waiting-on: —`" and passed no
 * flag; the turn stayed on `dev-core` from a notifier's letter, and the pair was
 * raised on a receiver where nothing had happened. A feed is append-only, so neither
 * message could be corrected: the only place to catch this is before the write.
 *
 * WHY ONLY THE RELEASE FORM, and not any mention of the markup. Measured over the
 * live mail AT ONE NAMED MOMENT — 2026-08-05, mail commit 9ad9f08, 1854 messages:
 * a scan for any `waiting-on:`/`parked-on:` in a body whose header carries neither
 * flags 7 messages, and 5 of them merely QUOTE another thread's field or a PR title
 * — the body is free text by contract and quoting is normal. The release form is the
 * narrow one: 22 messages mention it, 20 carry the field (never refused — the flag is
 * there), and the 2 that do not are exactly the defect. Zero false positives.
 *
 * The moment is named because the mail GROWS and every count above drifts with it
 * (two runs of the same scan an hour apart already disagreed by one message, and the
 * disagreement read as a wrong measurement rather than as a later one). What does not
 * drift is the shape of the answer, and that is what the narrow form rests on: the
 * wide scan is majority false positives, the narrow scan is exactly the defect.
 *
 * Fenced blocks are cut out first: a message DOCUMENTING the protocol pastes headers
 * as examples while its own turn stays where it is. Inline backticks are deliberately
 * kept — both real cases were written as inline `waiting-on: —`.
 *
 * THE SECOND FORM IS THE SAME CLAIM WITHOUT THE MARKUP (thread 058). The markup-only
 * door let the very sentence that reports obeying the rule through: on 2026-08-07 a
 * message on the red-main receiver wrote "Ход отсюда не передаётся никому — сказано
 * полем, а не прозой" and passed no flag. The turn stayed on `dev-core` from a
 * notifier's letter and raised a session onto a receiver where main was green and the
 * previous session's answer was already filed — the third such run of the class
 * (041/msg-009, 042 of 2026-08-05, 041/msg-019).
 *
 * Measured the same way, at one named moment — mail commit 08be7c26, 2112 messages:
 * the prose form matches 35 bodies, 24 of which the markup form does not see at all.
 * Of those 24 the header carries the field in 16 — never refused, the flag is there —
 * and does not in 8. SEVEN of the eight are the defect: 041/msg-009 and 041/msg-019,
 * which cost a raised session each, plus 042, 019, 032, 043 and 045, harmless only
 * because those threads were being closed on the same breath. The eighth is the
 * receiver's OWN standing message, whose "и ход отсюда уходит" describes the norm for
 * future answers rather than its own header — and the refusal there asks for
 * `--waiting-on —`, which is what that header meant anyway. The shape of the answer is
 * the one the narrow form rests on, unchanged: matches overwhelmingly carry the flag,
 * and the fieldless remainder is the defect rather than a quotation.
 *
 * THE LANGUAGE-NEUTRAL CANDIDATE WAS DROPPED BY THE SAME MEASURE, not by taste:
 * "whoever holds the turn must declare it" would refuse 51 of the 942 messages written
 * by the current holder, and most are lawful interim reports — a report does not end
 * the turn, the writer keeps working (project rule 11). A door that refuses the lawful
 * costs more than the defect it catches.
 *
 * The price of this form is named rather than hidden: the phrases are Russian, and this
 * package is built to move to a repository of its own. They live in one constant with
 * this comment over it — a mail written in another language extends the alternation and
 * nothing else.
 */
const FENCED_BLOCK = /^```[\s\S]*?^```/gm;
const INLINE_CODE = /`[^`\n]*`/g;
const TURN_RELEASE_MARKUP = /waiting-on:\s*`?\s*[—–]/;
/**
 * "ход" is required to stand as a word (the lookarounds keep `переходит`, `находится`
 * and `в этом ходе` out), and the assertion has to arrive within the same sentence.
 *
 * INLINE CODE IS CUT for this form and only for it — measured live, one minute after
 * the form was written: the message REPORTING this change was refused by it, because
 * describing the alternation puts "ход" and `отсюда уходит` in one sentence. Prose
 * about the protocol is the daily traffic of these threads, and a door that refuses
 * every message discussing it is a nuisance the writers would learn to route around.
 * None of the real cases hides in backticks — the defect is written as a plain
 * sentence. The markup form keeps reading them, exactly as thread 042 left it: both of
 * ITS live cases were written as inline `waiting-on: —`.
 */
const TURN_RELEASE_PROSE =
  /(?<![а-яё])ход(?![а-яё])[^.\n]{0,60}?(?:отсюда уходит|не переда[её]тся|никому не переда|снимаю)/i;

export const bodyClaimsTurnRelease = (text: string): boolean => {
  const prose = text.replace(FENCED_BLOCK, "");
  return TURN_RELEASE_MARKUP.test(prose) || TURN_RELEASE_PROSE.test(prose.replace(INLINE_CODE, ""));
};

/**
 * `waiting-on` off the wire. ONE role, or `—` for nobody. A list is REFUSED rather
 * than folded to its first element: a header that names two is either history that
 * the v13 migration has not been run over, or a writer still thinking in sets — and
 * both are answered by naming the migration, not by guessing whose turn it is.
 */
export const parseWaitingOnField = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed === "—" || trimmed === "") return null;
  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length > 1) {
    throw new MessageFormatError(
      `'waiting-on: ${trimmed}' — the turn is held by exactly one role since schema v13; run 'agent-protocol schema migrate' over the mail if this is history`,
    );
  }
  return (parts[0] as string) ?? null;
};

/** Parsing a message file: front matter inside `---` + body. */
export const parseMessageFile = (raw: string): Message => {
  const lines = raw.split("\n");
  if (lines[0] !== FENCE) {
    throw new MessageFormatError("a message file must start with a '---' line");
  }
  const close = lines.indexOf(FENCE, 1);
  if (close === -1) throw new MessageFormatError("the message header is not closed ('---')");

  const raws = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  for (const line of lines.slice(1, close)) {
    if (line.trim() === "") continue;
    const at = line.indexOf(":");
    if (at === -1) throw new MessageFormatError(`header line without 'key: value': '${line}'`);
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (REPEATABLE_HEADER_KEYS.includes(key)) {
      repeated.set(key, [...(repeated.get(key) ?? []), value]);
      continue;
    }
    // A duplicate of any other key USED TO WIN SILENTLY. Now it fails: see
    // REPEATABLE_HEADER_KEYS for why the silence stopped being tolerable.
    if (raws.has(key)) {
      throw new MessageFormatError(
        `header key '${key}' is given twice — only ${REPEATABLE_HEADER_KEYS.join(", ")} may repeat`,
      );
    }
    raws.set(key, value);
  }

  const from = raws.get("from");
  const dateRaw = raws.get("date");
  const expects = raws.get("expects");
  if (!from || !dateRaw || !expects) {
    throw new MessageFormatError("'from', 'date' and 'expects' are required in the header");
  }
  if (!ROLE.test(from))
    throw new MessageFormatError(`'from: ${from}' does not look like a role id`);
  // TOLERANT ON THE SPELLING, STRICT ON THE VALUE (thread 065, (iv)). The off-canon form is
  // normalized HERE and only in memory: the file keeps every byte it had (it is somebody
  // else's committed message, and those are never rewritten), and `messageFileName` rebuilds
  // the same name from the canon it now carries, so nothing on disk moves either.
  const notices: string[] = [];
  const filenameSpelled = FILENAME_TIMESTAMP.exec(dateRaw);
  const date =
    filenameSpelled === null
      ? dateRaw
      : `${filenameSpelled[1]}T${filenameSpelled[2]}:${filenameSpelled[3]}:${filenameSpelled[4]}Z`;
  if (filenameSpelled !== null) {
    notices.push(
      `'date: ${dateRaw}' is the file-name spelling of a UTC stamp — read as '${date}', the file itself is left as it is`,
    );
  }
  if (!DATE_ONLY.test(date) && !TIMESTAMP.test(date)) {
    throw new MessageFormatError(
      `'date: ${dateRaw}' — a UTC stamp like 2026-07-23T13:45:12Z is required (or a date for migrated messages)`,
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

  // FROM HERE ON A BAD FIELD IS DROPPED, NOT THROWN (thread 023): everything above decides
  // whose turn it is and stays all-or-nothing; everything below is read through `soft`, which
  // records the reason and returns nothing. See `Message.warnings` for why the line is drawn here.
  const warnings: string[] = [];
  const soft = <T>(read: () => T): T | undefined => {
    try {
      return read();
    } catch (error) {
      if (!(error instanceof MessageFormatError)) throw error;
      warnings.push(error.message);
      return undefined;
    }
  };

  // Provenance is OPTIONAL on read and always will be: legacy threads carry none by
  // construction (a `_thread.md` section has no header at all), and history predates
  // the field. Present but malformed is a defect of the writer — named, and left out.
  const worker = soft(() => {
    const value = raws.get("worker");
    if (value !== undefined && !WORKER.test(value)) {
      throw new MessageFormatError(
        `'worker: ${value}' — a worker id looks like a role id (${KNOWN_WORKERS.join(" | ")}, or another tool)`,
      );
    }
    return value;
  });
  const session = soft(() => {
    const value = raws.get("session");
    if (value !== undefined && !SESSION.test(value)) {
      throw new MessageFormatError(
        `'session: ${value}' — a session id must be one printable token without spaces (up to 128 characters)`,
      );
    }
    return value;
  });

  const launchRaw = raws.get("launch");
  const launch = launchRaw === undefined ? undefined : soft(() => parseLaunchDirective(launchRaw));

  const priority = soft(() => {
    const value = raws.get("priority");
    if (value !== undefined && !(THREAD_PRIORITY_VALUES as readonly string[]).includes(value)) {
      throw new MessageFormatError(
        `'priority: ${value}' — allowed values are ${THREAD_PRIORITY_VALUES.join(" | ")}`,
      );
    }
    return value;
  });

  // `parked-on` is a ROLE NAME or an EVENT and nothing else — the check that a role here
  // names a human (`wake.mode: 'self'`) needs the config and lives at the writing door, where
  // the config is in hand and a refusal can still be acted on. A reader of an append-only feed
  // cannot fix what is already written, so here the demand is only on the SHAPE of the value.
  const parkedOn = soft(() => {
    const value = raws.get("parked-on");
    if (value !== undefined && !ROLE.test(value) && !PARK_EVENT.test(value)) {
      throw new MessageFormatError(
        `'parked-on: ${value}' — expected the id of a role or an event ('pr:<number>', 'run:<number>')`,
      );
    }
    return value;
  });

  // The fact that LIFTS an event park, and the only one the courier of merges can state:
  // "PR N is in the default branch now". A number, because that is what the notifier has.
  const mergedPr = soft(() => {
    const value = raws.get("merged-pr");
    if (value !== undefined && !/^\d+$/.test(value)) {
      throw new MessageFormatError(`'merged-pr: ${value}' — expected the number of a PR`);
    }
    return value === undefined ? undefined : Number(value);
  });

  const tasks = (repeated.get("task") ?? []).flatMap((raw) => {
    const task = soft(() => parseTaskDeclaration(raw));
    return task === undefined ? [] : [task];
  });

  const fields: MessageFields = {
    ...(msgRaw === undefined ? {} : { msg: Number(msgRaw) }),
    ...(seqRaw === undefined ? {} : { seq: Number(seqRaw) }),
    from,
    ...(worker === undefined ? {} : { worker }),
    ...(session === undefined ? {} : { session }),
    date,
    expects: expects as Expects,
    ...(waitingRaw === undefined ? {} : { waitingOn: parseWaitingOnField(waitingRaw) }),
    ...(launch === undefined ? {} : { launch }),
    ...(priority === undefined ? {} : { priority: priority as ThreadPriorityValue }),
    ...(parkedOn === undefined ? {} : { parkedOn }),
    ...(mergedPr === undefined ? {} : { mergedPr }),
    ...(tasks.length === 0 ? {} : { tasks }),
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
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(notices.length === 0 ? {} : { notices }),
  };
};

export const renderMessageFile = (message: Message): string => {
  const { fields, text } = message;
  const head = [
    ...(fields.msg === undefined ? [] : [`msg: ${String(fields.msg).padStart(3, "0")}`]),
    ...(fields.seq === undefined ? [] : [`seq: ${String(fields.seq).padStart(3, "0")}`]),
    `from: ${fields.from}`,
    // Provenance stands next to authorship, because that is what it qualifies: who
    // said it, and what wrote it down.
    ...(fields.worker === undefined ? [] : [`worker: ${fields.worker}`]),
    ...(fields.session === undefined ? [] : [`session: ${fields.session}`]),
    `date: ${fields.date}`,
    `expects: ${fields.expects}`,
    ...(fields.waitingOn === undefined ? [] : [`waiting-on: ${fields.waitingOn ?? "—"}`]),
    // After `waiting-on` and before the historical `suffix`: the directive is about
    // the RUNS of this thread, so it reads next to the field that says whose turn it is.
    ...(fields.launch === undefined ? [] : [`launch: ${renderLaunchDirective(fields.launch)}`]),
    // Next to `launch` and for the same reason: both are statements about the RUNS of
    // this thread — with what it is raised, and how soon.
    ...(fields.priority === undefined ? [] : [`priority: ${fields.priority}`]),
    // Right after `waiting-on`'s neighbours, because it qualifies the turn itself: whose it
    // is, and whether it can move at all before a person says something.
    ...(fields.parkedOn === undefined ? [] : [`parked-on: ${fields.parkedOn}`]),
    // Beside `parked-on` because it is its counterpart: one freezes a turn behind an event,
    // this one says the event happened.
    ...(fields.mergedPr === undefined ? [] : [`merged-pr: ${fields.mergedPr}`]),
    // Last of the meaningful fields and repeatable: the declarations read as a block,
    // and a block that grows downwards leaves every field above it where it was.
    ...(fields.tasks ?? []).map((task) => `task: ${renderTaskDeclaration(task)}`),
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

/**
 * Section heading in the assembled thread. `number` is a display value: position or
 * historical number.
 *
 * PROVENANCE IS DELIBERATELY NOT HERE. The assembled `_thread.md` is the
 * CONVERSATION — who said what, when, to whom; `worker`/`session` are facts about
 * the RUN that typed it, and their reader is the analysis of runs, which reads the
 * files. Putting them in would also cost what is not worth this: the heading is
 * parsed BACK out of legacy `_thread.md` by a regex whose optional tail is a
 * historical suffix, the assembly canon is byte-exact across the live threads, and
 * every derived file in the repository would be rewritten to display a uuid nobody
 * reads in prose. It would also be the one field of the new shape that reaches a
 * DERIVED file — that is, the one that makes two package versions rewrite each
 * other's output (README, "Compatibility and breaking changes").
 */
export const renderHeading = (fields: MessageFields, number: number): string => {
  const shown = fields.msg ?? number;
  const suffix = fields.suffix === undefined ? "" : ` · ${fields.suffix}`;
  return `## msg-${String(shown).padStart(3, "0")} · from: ${fields.from} · ${fields.date.slice(0, 10)} · expects: ${fields.expects}${suffix}`;
};
