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
 * THE BOX'S OWN TWO LINES (thread 051) — deliberately NOT slots of the project's template
 * map, and the reason is R2 rather than taste: the map's KEYS are part of the frozen config
 * shape, so making these two overridable costs a protocol version and a migration step for
 * every box in the field. They are the package's operational voice about the machine it is
 * running on, they name no role and no thread, and their readers are the operator and
 * whoever can log in. If a project ever needs them in its own language, that is a version
 * bump made on purpose — asked in the thread, not taken here in silence.
 */
export const BOX_ALARM_KINDS = ["auth", "gh-outage"] as const;
export type BoxAlarmKind = (typeof BOX_ALARM_KINDS)[number];

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

/** The two box-wide texts, in the package's own English — see {@link BOX_ALARM_KINDS}. */
export const BOX_ALARM_TEMPLATES: Readonly<Record<BoxAlarmKind, string>> = {
  auth: "the box cannot authenticate to the vendor: {deaths} runs in a row died on its credentials since {since}. Nothing is raised until {until}, and nothing will be until somebody logs in on the box — the circuit is standing still",
  "gh-outage":
    "merge-ready has been refused by gh for {ticks} ticks in a row (threshold {threshold}) since {since}: {refusal}. Nothing is broken by it — the queue is ordered as it would be without the tier — but the tier is off until this is fixed",
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
  readonly kind: NotificationKind | BoxAlarmKind;
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
 *
 * IT RINGS ONCE, ON THE MESSAGE THAT ASKED (thread 051, john's pain of 2026-08-03). A park is
 * the one class of event that does not go away by itself — the turn stays frozen for as long
 * as the person takes — so a courier that prints the full composition every time it has
 * anything else to say repeats the same ❓ for days. It was measured live on 016 (a park held
 * as a MODE by john's own decision) and on 049 (a park over two manual operations, ringing
 * with its questions already closed). The mark has to mean "there is a question you have not
 * read"; a mark that means "this thread is still parked" teaches the reader to skip it, and
 * the missed call that follows is dearer than the one that was never made.
 */
export type ParkedThread = {
  readonly thread: string;
  readonly person: RoleId;
  readonly since: string;
  /** The first line of the parking message — the question, in the words it was asked in. */
  readonly question: string;
  /**
   * Whether the parking message asks anything of the person (`expects` is not `none`) — a park
   * declared by an INFORMATIONAL message freezes the thread exactly the same way and calls
   * nobody. `ack` calls: it is "I stand until you confirm", and a silent freeze costs more than
   * a ❓ too many (curator, 2026-08-03) — see `Parking.asks` for the whole reason.
   */
  readonly asks: boolean;
};

/**
 * THE FOURTH AND FIFTH CLASSES OF EVENT — THE ONES WITH NO THREAD AT ALL (thread
 * `051-ringing-predicates`).
 *
 * Everything above is a fact about a conversation: a turn that has passed, a turn that has
 * not moved, a turn frozen behind a person. These two are facts about the BOX, and that is
 * exactly why they need their own slots rather than a thread to hang on:
 *
 *  - the AUTHORISATION SHELF (`orchestrator/auth.ts`): every session raised on this box
 *    dies on its first turn because the vendor refuses its credentials. There is no thread
 *    whose turn is stuck — every thread's turn is stuck — so `stalledAfterMinutes` is not
 *    applicable to it BY CONSTRUCTION, and like a park it rings with NO threshold of its
 *    own. Its threshold is the predicate that produced it (`authAlarmDue`: the second death
 *    in a row), and that decision is not made twice;
 *  - the MERGE-READY OUTAGE (`orchestrator/outage.ts`): `gh` has been refusing the tier for
 *    a run of ticks. Nothing is broken by it — the queue degrades to the order it would
 *    have without the tier — but a feature the operator believes in is off, silently.
 *
 * BOTH ARE KEYED BY A STAMP, like the stall and the park, and for the identical reason: an
 * outage that ends and starts again is a NEW event, and keying by "there is an outage"
 * would swallow the second one for as long as the daemon lived. What the stamp means is
 * different in each case, and each says so at its own field.
 */
export type AuthAlarm = {
  /** The stamp of the LAST authorisation death — the shelf this rings for. */
  readonly since: string;
  /** How many runs in a row died on the credentials. */
  readonly deaths: number;
  /** When the box next knocks on the door (one pair raised as the probe). */
  readonly until: string;
};

/** One run of identical refusals from `gh`, long enough to be worth a human's phone. */
export type GhAlarm = {
  /** When THIS run of refusals began — its identity, and what the state is keyed by. */
  readonly since: string;
  /** How many consecutive ticks were refused. */
  readonly ticks: number;
  /** The threshold that was crossed, carried so the message can print it beside the count. */
  readonly threshold: number;
  /** The vendor's own sentence, verbatim — the fact, never a guess at what it means. */
  readonly refusal: string;
};

/** What was announced last run: the five classes of event in one file. */
export type NotifyState = {
  readonly waiting: readonly WaitingPair[];
  readonly stalled: readonly StalledTurn[];
  readonly parked: readonly ParkedThread[];
  /** The stamp of the authorisation shelf already announced, if any. */
  readonly auth?: string | undefined;
  /** The stamp of the merge-ready outage already announced, if any. */
  readonly gh?: string | undefined;
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
  /**
   * Parks not announced before AND asking something — the same rule, keyed by the message that
   * parked, and the ONLY parks that produce a line: a park in force but already announced is
   * silent from the second digest on, and one declared by an informational message is silent
   * from the first.
   */
  readonly freshParked: readonly ParkedThread[];
  /** The authorisation shelf in force now, if the predicate rings — also part of the state. */
  readonly auth?: AuthAlarm | undefined;
  /** The merge-ready outage in force now, if the predicate rings — also part of the state. */
  readonly gh?: GhAlarm | undefined;
  /** True when this shelf has not been announced yet: ONE DELIVERY PER SHELF, not per tick. */
  readonly freshAuth: boolean;
  /** True when this run of refusals has not been announced yet — same rule, same reason. */
  readonly freshGh: boolean;
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
    // The two box-wide events are one line each and carry only their stamp: what
    // identifies them is the shelf and the run of refusals, and the rest is re-read from
    // the journal and the outage file every time.
    ...(state.auth === undefined ? [] : [`auth\t${state.auth}`]),
    ...(state.gh === undefined ? [] : [`gh\t${state.gh}`]),
  ];
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
};

export const parseNotifyState = (raw: string): NotifyState => {
  const waiting: WaitingPair[] = [];
  const stalled: StalledTurn[] = [];
  const parked: ParkedThread[] = [];
  let auth: string | undefined;
  let gh: string | undefined;
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
      // `asks` is not stored for the third time for the same reason — the state answers one
      // question ("was this event announced"), and it answers it by the key alone.
      if (person !== undefined && thread !== undefined && since !== undefined) {
        parked.push({ person, thread, since, question: "", asks: false });
      }
      continue;
    }
    if (columns[0] === "auth") {
      if (columns[1] !== undefined) auth = columns[1];
      continue;
    }
    if (columns[0] === "gh") {
      if (columns[1] !== undefined) gh = columns[1];
      continue;
    }
    const [role, thread] = columns;
    if (role !== undefined && thread !== undefined) waiting.push({ role, thread });
  }
  return { waiting, stalled, parked, auth, gh };
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
  /**
   * The box's own credentials are refused and the predicate rings (thread 051). NOT filtered
   * by target the way a park is: it names no role because it belongs to no thread — it is
   * delivered whenever there is anybody human to deliver to at all, and is dropped when
   * there is not, since a message about a dead box has no second reader.
   */
  readonly auth?: AuthAlarm | undefined;
  /** The merge-ready tier has been refused for a run of ticks past its threshold. */
  readonly gh?: GhAlarm | undefined;
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
  // A PARK IS AN EVENT, NOT A STATE, FOR THE COURIER (thread 051): it rings on the message
  // that asked, once, and the composition below keeps it only so that the age pass stays
  // quiet about it and the state remembers it was told. `asks` is the message's own word:
  // `expects: none` says it wants nothing of anybody, and ❓ over it is a lie by mark.
  const freshParked = parked.filter((park) => park.asks && !seenParks.has(parkedKey(park)));

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

  // THE BOX-WIDE EVENTS ARE DROPPED WHEN NOBODY HUMAN IS CONFIGURED, and the reason is the
  // one that governs a park: a notification is an instruction to a reader, and both of
  // these can only be acted on by a person at (or with access to) the machine.
  const human = input.targets.some((target) => target.style === "direct");
  const auth = human ? input.auth : undefined;
  const gh = human ? input.gh : undefined;
  const freshAuth = auth !== undefined && auth.since !== input.seen.auth;
  const freshGh = gh !== undefined && gh.since !== input.seen.gh;

  const lines: NotificationLine[] = [];
  // THE BOX COMES BEFORE THE MAIL. A shelved box means none of the lines below can be acted
  // on by the circuit at all — reading "your turn: 042" first and "nothing is being raised"
  // last is the wrong order to learn those two facts in.
  if (auth !== undefined)
    lines.push({
      kind: "auth",
      thread: "",
      role: "",
      text: renderTemplate(BOX_ALARM_TEMPLATES.auth, {
        deaths: String(auth.deaths),
        since: auth.since,
        until: auth.until,
      }),
    });
  if (gh !== undefined)
    lines.push({
      kind: "gh-outage",
      thread: "",
      role: "",
      text: renderTemplate(BOX_ALARM_TEMPLATES["gh-outage"], {
        refusal: gh.refusal,
        since: gh.since,
        ticks: String(gh.ticks),
        threshold: String(gh.threshold),
      }),
    });
  // THE PARKS COME FIRST, and they are the only lines that name a question: this is the
  // section "waiting on your decision", and it is at the top because it is the only part of
  // the message that is an instruction to the reader rather than a report about the circuit.
  //
  // AND IT IS THE FRESH ONES, not the composition — the one place in this function where the
  // message is NOT the full picture, deliberately (thread 051). Every other line is a fact
  // that is true again each time it is printed ("your turn: 042" is an instruction the reader
  // has still not carried out); a question is read once. A park already announced therefore
  // produces NO LINE AT ALL rather than a quieter one: the second form was available and was
  // not taken, because the digest is a courier of events and the standing picture is what
  // `cli mail` and the operator frame are for — a state line repeated for days is the same
  // noise with a smaller mark.
  for (const park of freshParked) {
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

  return {
    waiting,
    stalled,
    parked,
    fresh,
    freshStalled,
    freshParked,
    auth,
    gh,
    freshAuth,
    freshGh,
    lines,
  };
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
