/**
 * WHO IS TOLD THAT THE TURN HAS PASSED, AND WHEN (R4, thread `016-protocol-roadmap`).
 *
 * The watch wakes an AGENT. The other direction — "the turn has passed to a human"
 * — lived in `bin/notify.sh`, a bash script in the project zone: it parsed the mail
 * with the shared entry point, but the SET of those notified was the string
 * `NOTIFY_ROLES="john curator"`, the wording of the two cases was a branch inside an
 * awk program, and the texts were Russian prose baked into a script that also knew
 * how to talk to Telegram. Three things in one file, none of them the same thing.
 *
 * They come apart along the lines the package already draws:
 *
 *  - **WHOM to notify is derived from the role model** (P1): `wake.mode: self` is a
 *    human who reads notifications, `via-human` is an assistant with no process of
 *    its own who comes alive only when the named human opens the chat. That is
 *    `registry.notificationTargets()`, and it has carried the comment "the text is
 *    not our business: it is the project's" since P1 — this module is that promise
 *    coming due. A configurable role list is deliberately NOT reintroduced: it would
 *    be a second place to say what the role model already says, and the awk branch
 *    for "some other role" that used to exist for it is dropped with it — with the
 *    set derived, the case cannot occur.
 *  - **WHEN is a change of composition**, not the fact of waiting. A ping every five
 *    minutes about the same thread trains its reader to ignore it.
 *  - **WHAT IS SAID is the project's** — templates, `template.ts`.
 *  - **HOW IT IS DELIVERED is a transport**, a separate package (`transport.ts`).
 *
 * THE TRIGGER IS A NEW PAIR, THE TEXT IS THE FULL COMPOSITION — carried over
 * verbatim from the script, because both halves were paid for. Notify on appearance
 * only, or the same thing arrives every tick; but say ALL of it, because a list of
 * one reads as "everything else is closed", and that would be a lie at the price of
 * a forgotten thread.
 *
 * THE UNIT IS A THREAD, NOT A ROLE (thread 008): a new piece of work for john is a
 * new message even if john was already waiting on something else.
 *
 * THE SECOND CLASS OF EVENT — A TURN THAT HAS NOT MOVED (thread 024, after v13).
 * Everything above answers "who is awaited"; since schema v13 a human is outside the
 * domain of the turn by construction, so that question can no longer produce a line
 * for one: `waiting-on` never names john again, the trigger "the target APPEARED in
 * the field" never fires, and the only automatic courier to the human fell out with
 * it (measured, not assumed: a dry run right after the migration showed two waits,
 * both legacy prose, and the one thread that really did stand at john's door was not
 * shown at all).
 *
 * What is left observable when the human is out of the field is the AGE OF THE TURN:
 * a fork that stands still. So the notifier gains a second question — "has anything
 * been waiting longer than N?" — and it is deliberately asked about EVERY open thread,
 * not only about the ones somebody marked as a question for a human:
 *
 *  - a thread whose turn sits on an agent for hours is a stalled circuit (nobody
 *    raised the role, or every raise ends without passing the turn on) — that is the
 *    human's business too, and there is no second mechanism that would say it;
 *  - a marker "this one is really for john" would be a second place to say what the
 *    thread already says, and it would be written by exactly the sessions that are
 *    stuck, i.e. the least reliable narrator available.
 *
 * The age is measured from the HANDOFF (`waitingSince`), not from the last message:
 * a session that answers in the thread without passing the turn on has not moved the
 * fork, and letting its message reset the clock is how a stuck thread stays quiet
 * forever. Threads that already produce a `turn`/`nudge` line are excluded — the
 * human is being told about them anyway, and two lines about one id make the reader
 * ask which of them to act on (the same reason `turn-with-nudge` exists).
 */
import type { NotificationTarget } from "../roles/registry.js";
import type { RoleId } from "../roles/schema.js";
import { renderTemplate } from "./template.js";

/** One thread waiting on one role — the unit of both the state and the decision. */
export type WaitingPair = {
  readonly role: RoleId;
  readonly thread: string;
};

/**
 * THE THREE SLOTS, and the third one is why this is data and not a formatted
 * string with an `if` in it.
 *
 * - `turn` — a thread is waiting on a human;
 * - `turn-with-nudge` — the same thread is ALSO waiting on an assistant. The script
 *   said this as a suffix ("(the curator is next)") glued on by an awk branch,
 *   because a thread waiting on both is in practice a queue and not a parallel: the
 *   human's move (acceptance, merge, a decision) comes first. Two equal lines about
 *   one id made the reader ask "which one first";
 * - `nudge` — a thread waiting ONLY on an assistant, which means "open the chat and
 *   poke them", because there is no process to wake.
 *
 * A CONDITIONAL IN A TEMPLATE IS EXACTLY WHAT IS BEING AVOIDED HERE. The fact
 * ("somebody else is waiting on this thread too") is known to the package, so the
 * package picks the slot and the project writes two plain sentences — rather than
 * the project learning a template language with branches, which is the road to a
 * dialect nobody can validate.
 */
export const NOTIFICATION_KINDS = [
  "parked",
  "turn",
  "turn-with-nudge",
  "nudge",
  "stalled",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** What each slot is given. The door validates project templates against exactly this. */
export const NOTIFICATION_VARIABLES: Readonly<Record<NotificationKind, readonly string[]>> = {
  parked: ["thread", "question"],
  turn: ["thread", "role"],
  "turn-with-nudge": ["thread", "role", "nudged"],
  nudge: ["thread", "role", "via"],
  stalled: ["thread", "role", "age"],
};

/**
 * The package's own texts — ENGLISH, and that is the whole of R1's answer to "which
 * language does a protocol speak": its own prose is English, and a project that
 * wants its team's language writes it down as data. A default that is silence would
 * be worse than one in the wrong language: an unconfigured notifier that delivers
 * nothing is indistinguishable from a working one.
 */
export const DEFAULT_NOTIFICATION_TEMPLATES: Readonly<Record<NotificationKind, string>> = {
  parked: "your decision: {thread} — {question}",
  turn: "your turn: {thread}",
  "turn-with-nudge": "your turn: {thread} (and {nudged} is waiting on it as well)",
  nudge: "{thread} is waiting on {role}, who comes alive only through {via} — open the chat",
  stalled: "{thread} has not moved for {age} — the turn is with {role}",
};

/** The announcements the package writes INTO A THREAD; same mechanism, different reader. */
export const ANNOUNCEMENT_KINDS = ["force-stop"] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

export const ANNOUNCEMENT_VARIABLES: Readonly<Record<AnnouncementKind, readonly string[]>> = {
  "force-stop": ["thread", "by", "reason"],
};

/**
 * The default force-stop announcement is the text R1 translated, kept word for word.
 * It is the one message the package composes and signs with somebody else's role, so
 * a project that speaks another language in its threads has a reason to override it
 * — which is the reason this slot exists at all.
 */
export const DEFAULT_ANNOUNCEMENT_TEMPLATES: Readonly<Record<AnnouncementKind, string>> = {
  "force-stop": "The session on thread {thread} was force-stopped (by {by}): {reason}",
};

/** One rendered notification line, with the facts that produced it kept beside the text. */
export type NotificationLine = {
  readonly kind: NotificationKind;
  readonly thread: string;
  readonly role: RoleId;
  readonly text: string;
};

/**
 * One thread whose turn has not moved for longer than the project's N.
 *
 * `since` is the HANDOFF stamp, and it is what the state is keyed by rather than the
 * thread alone: a fork that moves and then stalls again is a NEW event, and keying by
 * the id would swallow the second one silently.
 */
export type StalledTurn = {
  readonly thread: string;
  readonly role: RoleId;
  readonly since: string;
  /** How long, already rendered — the templates say it, nobody computes it twice. */
  readonly age: string;
};

/**
 * ONE THREAD FROZEN BEHIND A PERSON (R27), with the question it is frozen on.
 *
 * THE THIRD CLASS OF EVENT, and the one the human actually has to act on (thread 023,
 * john's own criterion: "having got the call, the person understands what is wanted of them
 * without opening the feed"). It has NO AGE THRESHOLD, and that is the point of it: a park
 * is a declaration that the turn cannot move until a person decides, so there is nothing to
 * wait out — measured live, a question parked at 11:08 would have lain silent until 14:08
 * under the age rule, because the watchdog read nothing but the age of the turn.
 *
 * `since` is the stamp of the message that parked it: a thread answered and parked again is
 * a NEW question, and keying by the id alone would swallow the second one.
 */
export type ParkedThread = {
  readonly thread: string;
  readonly person: RoleId;
  readonly since: string;
  /** The first line of the parking message — the question, in the words it was asked in. */
  readonly question: string;
};

/** What was announced last run: the three classes of event in one file. */
export type NotifyState = {
  readonly waiting: readonly WaitingPair[];
  readonly stalled: readonly StalledTurn[];
  readonly parked: readonly ParkedThread[];
};

export type NotificationPlan = {
  /** The full current composition, ordered — this is what the state file becomes. */
  readonly waiting: readonly WaitingPair[];
  /** The stalled turns in force now, ordered; also part of the state. */
  readonly stalled: readonly StalledTurn[];
  /** The parks in force now, ordered; also part of the state. */
  readonly parked: readonly ParkedThread[];
  /** What appeared since the previous run. Empty (with the two below) — nothing is sent. */
  readonly fresh: readonly WaitingPair[];
  /** Stalls not announced before — a stall that was already reported is not repeated. */
  readonly freshStalled: readonly StalledTurn[];
  /** Parks not announced before — the same rule, keyed by the message that parked. */
  readonly freshParked: readonly ParkedThread[];
  /** The message, one line per thread-and-human. Rendered from the FULL composition. */
  readonly lines: readonly NotificationLine[];
};

const key = (pair: WaitingPair): string => `${pair.role}\t${pair.thread}`;
const stalledKey = (turn: StalledTurn): string => `${turn.role}\t${turn.thread}\t${turn.since}`;
const parkedKey = (park: ParkedThread): string => `${park.person}\t${park.thread}\t${park.since}`;

/**
 * The state as a file: one event per line, ordered, so a diff of it is readable.
 *
 * A waiting pair keeps the two-column form it has always had, and a stall is a line
 * of four with the word in front — an old state file therefore still parses, and the
 * first run after this change does not read as "everything is new".
 */
export const renderNotifyState = (state: NotifyState): string => {
  const lines = [
    ...state.waiting.map(key),
    ...state.stalled.map((turn) => `stalled\t${stalledKey(turn)}`),
    ...state.parked.map((park) => `parked\t${parkedKey(park)}`),
  ];
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
};

export const parseNotifyState = (raw: string): NotifyState => {
  const waiting: WaitingPair[] = [];
  const stalled: StalledTurn[] = [];
  const parked: ParkedThread[] = [];
  for (const line of raw.split("\n").map((entry) => entry.trim())) {
    if (line === "") continue;
    const columns = line.split("\t");
    if (columns[0] === "stalled") {
      const [, role, thread, since] = columns;
      if (role !== undefined && thread !== undefined && since !== undefined) {
        // The age is not stored: it changes every tick, and what identifies the event
        // is the handoff it is counted from.
        stalled.push({ role, thread, since, age: "" });
      }
      continue;
    }
    if (columns[0] === "parked") {
      const [, person, thread, since] = columns;
      // The question is not stored either, for the same reason the age is not: what
      // identifies the event is the message that parked, and the text is re-read from it.
      if (person !== undefined && thread !== undefined && since !== undefined) {
        parked.push({ person, thread, since, question: "" });
      }
      continue;
    }
    const [role, thread] = columns;
    if (role !== undefined && thread !== undefined) waiting.push({ role, thread });
  }
  return { waiting, stalled, parked };
};

const ordered = (pairs: readonly WaitingPair[]): readonly WaitingPair[] =>
  [...pairs].sort((a, b) => a.thread.localeCompare(b.thread) || a.role.localeCompare(b.role));

/**
 * The decision. Pure: the mail, the targets and the previous state come in, the
 * message and the next state come out — the probes (reading threads, reading the
 * state file, sending) stay at the edge, as everywhere in this package.
 *
 * A pair whose role is not among the targets is dropped silently ON PURPOSE: the
 * caller passes the whole mail, and "a thread is waiting on dev-core" is not a
 * notification event — it is the watch's business.
 */
export const planNotifications = (input: {
  readonly targets: readonly NotificationTarget[];
  readonly waiting: readonly WaitingPair[];
  readonly seen: NotifyState;
  /** Turns that have stood longer than the project's N — the caller measures, this picks. */
  readonly stalled?: readonly StalledTurn[];
  /** Threads frozen behind a person (R27) — no threshold: the caller reads the feed, this picks. */
  readonly parked?: readonly ParkedThread[];
  /**
   * Threads frozen behind an EVENT rather than a person (R27, variant A of thread 023):
   * parked on the merge of a PR. They produce NO LINE AT ALL — neither a call ("your
   * decision is wanted" is false: the decision was made, the merge is somebody's hand on a
   * button) nor a stall ("nobody is moving this" is false too: it moves the moment the merge
   * lands and the notifier's message lifts the park). The one thing the courier owes such a
   * thread is silence, and it has to be said here, because on the age alone it looks exactly
   * like a dead turn.
   */
  readonly frozen?: readonly string[];
  readonly templates?: Partial<Record<NotificationKind, string>>;
}): NotificationPlan => {
  const byRole = new Map(input.targets.map((target) => [target.id, target]));
  const waiting = ordered(input.waiting.filter((pair) => byRole.has(pair.role)));
  const seen = new Set(input.seen.waiting.map(key));
  const fresh = waiting.filter((pair) => !seen.has(key(pair)));

  // A park is only an event for the person it names, and only if that person is one of
  // the targets: "parked on somebody the notifier does not write to" is not a call.
  const parked = [...(input.parked ?? [])]
    .filter((park) => byRole.get(park.person)?.style === "direct")
    .sort((a, b) => a.thread.localeCompare(b.thread));
  const seenParks = new Set(input.seen.parked.map(parkedKey));
  const freshParked = parked.filter((park) => !seenParks.has(parkedKey(park)));

  // A PARKED THREAD IS NEVER ALSO A STALLED ONE (thread 023). Both would be true of it —
  // the turn is not moving, by construction — but "your decision is wanted, here is the
  // question" and "nobody is moving this" are opposite instructions, and it was the second
  // one, printed about threads the circuit was chewing, that made the digest unreadable.
  const told = new Set([
    ...waiting.map((pair) => pair.thread),
    ...parked.map((p) => p.thread),
    ...(input.frozen ?? []),
  ]);
  const stalled = [...(input.stalled ?? [])]
    .filter((turn) => !told.has(turn.thread))
    .sort((a, b) => a.thread.localeCompare(b.thread));
  const seenStalls = new Set(input.seen.stalled.map(stalledKey));
  const freshStalled = stalled.filter((turn) => !seenStalls.has(stalledKey(turn)));

  const parkedIds = new Set(parked.map((park) => park.thread));
  const threads: string[] = [];
  for (const pair of waiting) {
    // A parked thread is announced by its own line above, and by that one only: "poke the
    // curator about it" is the wrong instruction for a thread whose turn is frozen behind
    // the reader of the notification.
    if (parkedIds.has(pair.thread) || threads.includes(pair.thread)) continue;
    threads.push(pair.thread);
  }

  const template = (kind: NotificationKind): string =>
    input.templates?.[kind] ?? DEFAULT_NOTIFICATION_TEMPLATES[kind];

  const lines: NotificationLine[] = [];
  // THE PARKS COME FIRST, and they are the only lines that name a question: this is the
  // section "waiting on your decision", and it is at the top because it is the only part of
  // the message that is an instruction to the reader rather than a report about the circuit.
  for (const park of parked) {
    lines.push({
      kind: "parked",
      thread: park.thread,
      role: park.person,
      text: renderTemplate(template("parked"), {
        thread: park.thread,
        question: park.question,
      }),
    });
  }
  for (const thread of threads) {
    const here = waiting.filter((pair) => pair.thread === thread);
    const directs = here.filter((pair) => byRole.get(pair.role)?.style === "direct");
    const nudges = here.filter((pair) => byRole.get(pair.role)?.style === "nudge");

    if (directs.length > 0) {
      const nudged = nudges.map((pair) => pair.role).join(", ");
      for (const pair of directs) {
        const kind: NotificationKind = nudges.length > 0 ? "turn-with-nudge" : "turn";
        lines.push({
          kind,
          thread,
          role: pair.role,
          text: renderTemplate(template(kind), { thread, role: pair.role, nudged }),
        });
      }
      continue;
    }

    // Nobody human is waiting: every assistant on the thread gets its own line —
    // "poke them" is an action per assistant, and merging them would hide the second.
    for (const pair of nudges) {
      const target = byRole.get(pair.role);
      const via = target?.style === "nudge" ? target.nudge : "";
      lines.push({
        kind: "nudge",
        thread,
        role: pair.role,
        text: renderTemplate(template("nudge"), { thread, role: pair.role, via }),
      });
    }
  }

  // The stalls come after the waits, and each is its own line: "nobody is moving this"
  // is a different action from "your turn", and merging them would hide the first.
  for (const turn of stalled) {
    lines.push({
      kind: "stalled",
      thread: turn.thread,
      role: turn.role,
      text: renderTemplate(template("stalled"), {
        thread: turn.thread,
        role: turn.role,
        age: turn.age,
      }),
    });
  }

  return { waiting, stalled, parked, fresh, freshStalled, freshParked, lines };
};

/**
 * How long, in the words a human reads: "3h 20m", "2d 4h", "45m". Rounded down and
 * two units deep on purpose — the number is a reason to look, not a measurement.
 */
export const describeAge = (minutes: number): string => {
  const whole = Math.max(0, Math.floor(minutes));
  if (whole < 60) return `${whole}m`;
  const hours = Math.floor(whole / 60);
  if (hours < 24) return whole % 60 === 0 ? `${hours}h` : `${hours}h ${whole % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
};

/** The message as it goes to the transport: one text, the lines in order. */
export const renderNotification = (lines: readonly NotificationLine[]): string =>
  lines.map((line) => line.text).join("\n");

/** An announcement into a thread — the same templating, the project's language. */
export const renderAnnouncement = (input: {
  readonly kind: AnnouncementKind;
  readonly variables: Readonly<Record<string, string>>;
  readonly templates?: Partial<Record<AnnouncementKind, string>>;
}): string =>
  renderTemplate(
    input.templates?.[input.kind] ?? DEFAULT_ANNOUNCEMENT_TEMPLATES[input.kind],
    input.variables,
  );
