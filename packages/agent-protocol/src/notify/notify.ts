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
import type { LeaseView } from "../orchestrator/lease.js";
import { BOX_ACCOUNT, describeAccount } from "../orchestrator/quota.js";
import { describeFreeze, type FailureClass } from "../orchestrator/thaw.js";
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
 *
 * THE TWO FREEZES JOIN THEM (thread 013) even though they DO name a role and a thread, and
 * the reason is the same one: what they report is the CIRCUIT's own machinery — the attempt
 * ceiling of the orchestrator — stopping to raise a pair, not anything that happened in the
 * conversation. Nobody in the thread wrote them, and no reader of the thread can answer
 * them; the action behind `frozen` is a person's, and the action behind `exhausted` is a
 * clock's. Making them project slots would change the KEYS of the frozen config shape,
 * which is john's decision and not a side effect of this thread (see above).
 *
 *  - `exhausted` — a pair has just entered a freeze that ENDS BY ITSELF: the vendor's side
 *    failed and the backoff of `thaw.ts` is running. One call per series, and rounds 2 and
 *    3 of the same series are silent — they are visible to whoever looks (the standing
 *    counters of the courier line and the `status` frame print them every tick) and there
 *    is no action behind them, so they do not ring;
 *  - `frozen` — the terminal: an external freeze whose schedule is spent, or a substantive
 *    one, which is terminal from its first second. THIS is the call that means "a human is
 *    needed" — nothing but a delivery into the thread will move that pair again.
 */
export const BOX_ALARM_KINDS = [
  "auth",
  "gh-outage",
  "exhausted",
  "frozen",
  "unaccepted",
  "unaccepted-stale-park",
  "code-drift",
] as const;
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
  // THE LINE NAMES THE ACCOUNT (B.4) AND NO COMMAND (thread 026). Naming the account is
  // what makes the alarm actionable on a box that holds two: repairing the wrong one leaves
  // the shelf exactly where it was and reads as the alarm lying.
  //
  // THE COMMAND IS SPELLED WHEN, AND ONLY WHEN, THE BOX SAID WHOSE ACCOUNT IT IS (thread
  // 026, П3-3). This used to be the one repair site of thread 026 where
  // {@link AgentKind.loginHint} could not be used, and the reason was written here: the
  // alarm is keyed by an ACCOUNT, and an account carried no kind, so nothing at this point
  // knew which vendor's login would lift the shelf. `accounts.<id>.kind` is that missing
  // half; with it declared the sentence names the command, and the operator of a codex box
  // reads `codex login --with-api-key` rather than a claude command that can be typed in
  // full and change nothing.
  //
  // `{repair}` IS EMPTY WHEN NOTHING IS DECLARED, and that is not a regression — it is the
  // same line this alarm rang before the field existed. The one thing it may not do is
  // guess: an invented login is worse than a named standstill, because it looks like an
  // action. `planNotifications` stays pure — the caller resolves the hint and hands it in,
  // exactly as it hands the account and the stamps.
  auth: "the box cannot authenticate to the vendor for {account}: {deaths} runs in a row died on its credentials since {since}. Nothing is raised for it until {until}, and nothing will be until somebody logs that account in on the box{repair} — the roles that spend it are standing still",
  "gh-outage":
    "merge-ready has been refused by gh for {ticks} ticks in a row (threshold {threshold}) since {since}: {refusal}. Nothing is broken by it — the queue is ordered as it would be without the tier — but the tier is off until this is fixed",
  // NEITHER LINE ASKS FOR ANYTHING IN THE FIRST CASE AND BOTH SAY WHOSE MOVE IT IS. The
  // whole defect this comes from is a pair standing for five hours with nobody told, so the
  // texts are built around the one question its reader has: "must I do something now".
  exhausted:
    "{role} is no longer being raised on {thread}: {attempts} attempts in a row failed and the vendor's side is what spent them ({detail}). Nothing to do — the box knocks again by itself; you are told so that a queue that stopped moving is not a mystery",
  // AND THE TERMINAL LINE NAMES A MOVE THAT EXISTS (curator's §1, thread 013). It used to
  // end "it moves when a message lands in that thread", which is advice to the reader whose
  // only question is what to do: the count is zeroed by a delivery EVENT OF THIS PAIR, every
  // shape of which is written by a RUN of it, and the pair is refused before it runs. A
  // letter into the thread — from another role, or from another session of this one —
  // creates no event of the pair at all, and the three that stood on 2026-08-18 stayed
  // frozen through exactly such letters.
  // AND THE EIGHTH CLASS SPEAKS IN THE BOX'S VOICE TOO (thread 042), for the reason the two
  // freezes do: what it reports is the CIRCUIT failing to raise a pair, not anything that
  // happened in the conversation. Nobody in that thread wrote it and nobody in it can answer
  // it — the reader is whoever can look at the daemon. It says the three facts the reader
  // needs to skip the whole diagnosis the four cases of 2026-08-28 cost by hand: which pair,
  // how long, and that the box itself has NOTHING against the pair.
  unaccepted:
    "{role}×{thread} has been standing for {age} and this box has not raised it: the role is free, the thread is not parked, the pair is not out of attempts, and the daemon names no reason to skip it. Nothing in the mail is wrong — look at the box (is the daemon up, are launches enabled, is this role in its scope)",
  // THE SAME STANDSTILL WITH A REASON ON SCREEN THAT IS NOT ABOUT THIS PAIR (thread 042). It
  // is separate from the line above and not a variant of it, because the reader's move is a
  // different one: there is nothing to check on the box, the park is simply stale and the
  // thread needs a letter that moves the turn. The daemon says `PARKED behind a decision of
  // {person}` at every tick, so a call that said "the daemon names no reason" would send the
  // reader looking for a fault that is not there — which is the four hours of 2026-08-28.
  "unaccepted-stale-park":
    "{role}×{thread} has been standing for {age} behind a park on {person} that was declared on ANOTHER role's turn: the turn has moved to {role} since, and nothing is wanted of {person} by this pair. The daemon skips it every tick as parked — that line is true of the thread and false of the pair, so the move is to lift or re-declare the park, not to look at the box",
  // THE NINTH CLASS SPEAKS ABOUT THE BOX ITSELF AND NOT ABOUT ANY PAIR (thread 044). The
  // daemon picks up merged code only in a window with no live lease; on an active circuit
  // that window can be missed for hours, and until this line the refusal lived in
  // `daemon.log` alone — measured on 28–29.08, when a repair merged at 03:24Z was carried by
  // nobody until a human noticed in the morning that the courier was still ringing with a
  // false reason the box had already fixed.
  //
  // IT NAMES THE REASON THE DAEMON GAVE, VERBATIM, and asks for nothing beyond looking: what
  // to do about a window that is not opening — wait, stop a session, restart by hand — is a
  // judgement about live work, and the statement of this thread is explicit that no forced
  // rollout is invented without john. The line reports; the person decides.
  "code-drift":
    "this box is running code {sha} while {ref} is {refSha}: {size}, and it has not picked the new code up — {why}. Nothing in the mail is wrong; what the circuit is executing is not what was merged",
  frozen:
    "{role}×{thread} is frozen for good: {detail}. The circuit will not raise this pair again by itself, and no message into that thread lifts it — the move is a run let through by hand (`orchestrator run --max-attempts` above the ceiling), whose handoff zeroes the count",
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
 * ONE PAIR WHOSE TURN THE BOX HAS NOT TAKEN (thread 042) — the eighth class, and the one
 * that produced NO SIGNAL AT ALL until it existed.
 *
 * The picture it is built for: `waiting-on` names a role THIS box raises, the role is free,
 * the thread is not parked and not frozen, the pair is not at the attempt ceiling — and no
 * session is raised, tick after tick. Nothing in the mail is wrong, so no category above can
 * see it: it is not a wait on a human, not a park, not a freeze, and the 180-minute stall is
 * a threshold for a working day, not for a queue whose tick is thirty seconds. Measured on
 * 2026-08-28/29, four times in one day (1 h 52 m, 4 h 52 m, 19 m, ~7 m), and every one of
 * them was found by a HUMAN reading the feed.
 *
 * `since` is the HANDOFF stamp, exactly as it is for a stall, and it is the identity for the
 * same reason: a pair raised, released and left standing again is a NEW event, and the key
 * resets by itself the moment the turn is taken (the raise postdates the handoff, so the pair
 * leaves the composition) or the turn moves on (a new handoff, a new stamp).
 *
 * `reason` IS THE HALF THAT KEEPS THE LINE HONEST. The box knows some reasons for not raising
 * a pair — the ceiling is spent, the account's window is closed, its credentials are refused,
 * launches are disabled — and a pair held back by one of those is NOT a defect and must not
 * ring: it is printed with its reason in the courier's standing line and nothing else. What
 * rings is the pair with NO reason at all, which is the second and worse defect of the
 * statement: the box has nothing against this pair and is still not raising it.
 */
export type UnacceptedTurn = {
  readonly role: RoleId;
  readonly thread: string;
  /** The handoff this is counted from — the identity of the event. */
  readonly since: string;
  /** How long it has stood, already rendered — nobody computes it twice. */
  readonly age: string;
  /**
   * What the box knows is holding the pair back, in its own words. ABSENT IS THE ALARM: the
   * box named no reason, and a pair nobody has anything against that is still not raised is
   * the thing a human had to find by eye four times on 2026-08-28.
   */
  readonly reason?: string | undefined;
  /**
   * THE PERSON OF A PARK THIS PAIR ONLY INHERITED (thread 042, §1 of 2026-08-29). Set when the
   * thread IS parked on a human but the park was declared on ANOTHER role's turn: the daemon
   * skips the pair every tick saying "parked behind a decision of {person}", and that sentence
   * is true about the thread and false about the pair. It is the measured defect — the worst of
   * the four windows, 4 h 16 m — and it rings with its own words, because "the box names no
   * reason" would be the wrong instruction: there IS a reason on screen, and it is stale.
   */
  readonly staleParkOn?: RoleId | undefined;
};

/** The identity of one unaccepted turn: the pair and the handoff it has been standing on. */
export const unacceptedKey = (turn: Pick<UnacceptedTurn, "role" | "thread" | "since">): string =>
  `${turn.role}\t${turn.thread}\t${turn.since}`;

/**
 * AFTER HOW LONG AN UNTAKEN TURN IS ITSELF AN EVENT — ten minutes, and the number is a
 * measurement rather than a taste.
 *
 * The daemon's tick is 30 seconds by default (`orchestrator daemon --tick`), and a healthy
 * raise costs one tick plus the mail fetch — under two minutes on the boxes this runs on. Ten
 * minutes is twenty ticks: an order of magnitude above a normal acceptance, so a pair that
 * crosses it is not "slow", it is not being raised at all. The statement of thread 042
 * proposed 15–20; the band was taken DOWN rather than up because three of its four measured
 * cases (1 h 52 m, 4 h 52 m, 19 m) are caught either way and the fourth (~7 m) is caught by
 * neither, while the class only ever fires when the box can name no reason — so the cost of
 * the lower threshold is not noise, it is an earlier call on a real standstill.
 *
 * A CONSTANT AND NOT A CONFIG KEY, deliberately: a new key in `notifications` is a new
 * protocol version and a migration for every box in the field (R2), which is john's decision
 * and not a side effect of this repair. It is stated here, in the package's own voice, like
 * {@link GH_OUTAGE_TICKS} beside it; if a project ever needs its own N, that is a version
 * bump asked for in the thread.
 */
export const UNACCEPTED_AFTER_MINUTES = 10;

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
  /**
   * WHOSE TURN THE PARK WAS DECLARED ON (thread 042) — {@link Parking.holder}, carried through.
   * A park covers the pair it was declared about; the pair that inherited it by a later handoff
   * is NOT parked, it is unraised, and telling the two apart is the whole of check (в).
   * Undefined reads as "covers whoever holds the turn" — the behaviour of every reader before
   * this field existed, and what a park declared by a message with no `waiting-on` deserves.
   */
  readonly holder?: RoleId | undefined;
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
  /**
   * WHOSE CREDENTIALS (B.4). The shelves are per account since B.3, and this is the half of
   * the identity that the stamp alone does not carry: two accounts can be shelved at once,
   * and their `since` can be the same second. It is the raw id — {@link BOX_ACCOUNT} for a
   * box that named none — and the human phrasing is {@link describeAccount}'s.
   */
  readonly account: string;
  /** The stamp of the LAST authorisation death — the shelf this rings for. */
  readonly since: string;
  /** How many runs in a row died on the credentials. */
  readonly deaths: number;
  /** When the box next knocks on the door (one pair raised as the probe). */
  readonly until: string;
  /**
   * THE LOGIN THAT LIFTS THIS SHELF, when the box declared whose account it is
   * (`accounts.<id>.kind`, thread 026, П3-3) — already rendered by the caller, because
   * this module holds no config and may not learn to. Absent means the box claimed no
   * kind for that account, and the line then says the standstill without a command.
   */
  readonly repair?: string | undefined;
};

/**
 * The identity of one authorisation shelf for the courier: the PAIR (account, stamp).
 *
 * Keyed by the stamp alone (the form before B.4) a second account's alarm was swallowed
 * whenever its shelf carried the same `since` as the one already announced — which is not a
 * corner case: the stamps come from journal events, and two roles dying on two subscriptions
 * inside the same second is exactly what a box under a token outage does.
 */
export const authAlarmKey = (alarm: Pick<AuthAlarm, "account" | "since">): string =>
  `${alarm.account}\t${alarm.since}`;

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

/**
 * ONE PAIR THE CIRCUIT HAS STOPPED RAISING (thread 013) — the sixth class of event, and
 * the one that was invisible on 2026-08-18: three pairs stood at the ceiling for five
 * hours while the courier's line said `nothing to announce`, and a HUMAN found them by
 * asking where the PR was.
 *
 * It is the pair's SERIES of freezes rather than one freeze, which is why `since` is the
 * stamp of the release that started the series (`LeaseView.exhaustedSince`) and never the
 * stamp of the current one: an external freeze thaws, retries, fails and freezes again,
 * and every one of those is the same event to whoever is being told about it.
 *
 * `failureClass`/`thaw` describe the freeze IN FORCE NOW and are absent in the gap — a
 * pair mid-series that is thawed, running or draining. Such a pair rings for nothing; it
 * stays in the composition only so that what was already announced about the series is not
 * forgotten while it is away.
 */
export type ExhaustedPair = {
  readonly role: RoleId;
  readonly thread: string;
  /** The identity of the series: the release that first took the counter to the ceiling. */
  readonly since: string;
  /** What spent the ceiling, while the pair is standing at it. */
  readonly failureClass?: FailureClass | undefined;
  /** When this freeze lifts by itself; `null` — it does not (see {@link describeFreeze}). */
  readonly thaw?: string | null | undefined;
  /** Failed attempts behind the series — printed in the text, not part of the identity. */
  readonly attempts?: number | undefined;
};

/**
 * THE SET THE SIXTH CATEGORY COUNTS OVER — the folded journal, minus the pairs whose
 * thread is CLOSED (thread 016).
 *
 * Two facts meet here and only here, which is why the selection is a function of its own
 * rather than a filter at a call site: the fold knows the freezes and nothing about the
 * mail, the mail knows the closures and nothing about the freezes. A pair of a closed
 * thread satisfies `exhaustedSince !== undefined` FOR GOOD — the counter is zeroed only by
 * a delivery of that pair, every shape of a delivery is written by a run, and a closed
 * thread gets no runs — so the courier announced it every tick and the digest advised a
 * hand (`--max-attempts` above the ceiling) towards a thread that had been accepted. A
 * standing lie rather than a stale one, and standing in the very line thread 013 built to
 * be believed.
 *
 * `closed` IS REQUIRED AND NOT OPTIONAL on purpose: this is the shape of the defect thread
 * 023 left behind (`sessionsThatWrote`, forgotten at one call site out of four) — an
 * argument a caller may leave out is one a caller will leave out, and the surface born
 * from that omission looks green.
 */
export const exhaustedPairsOf = (input: {
  readonly views: readonly LeaseView[];
  readonly closed: ReadonlySet<string>;
}): readonly ExhaustedPair[] =>
  input.views
    .filter((view) => view.exhaustedSince !== undefined && !input.closed.has(view.thread))
    .map((view) => ({
      role: view.role,
      thread: view.thread,
      since: view.exhaustedSince as string,
      attempts: view.attempt,
      // In force ONLY while the pair is actually standing at the ceiling: a thawed pair is
      // in the gap of its series, and a freeze that is not in force says nothing.
      ...(view.exhausted ? { failureClass: view.exhaustedClass, thaw: view.thawAt ?? null } : {}),
    }));

/**
 * WHICH OF THE TWO THINGS HAPPENED TO A PAIR, as an event with its own key: `exhausted` —
 * the series began and the backoff is running; `frozen` — the terminal, and the one that
 * needs a person. Both are keyed by the SERIES, so each rings exactly once for it.
 */
export type FreezeEvent = {
  readonly kind: "exhausted" | "frozen";
  readonly pair: ExhaustedPair;
};

/** The identity of one freeze announcement: its kind and the series it belongs to. */
export const freezeKey = (event: FreezeEvent): string =>
  `${event.kind}\t${event.pair.role}\t${event.pair.thread}\t${event.pair.since}`;

/** The series a freeze key belongs to — the three columns after the kind. */
const seriesOf = (key: string): string => key.split("\t").slice(1).join("\t");

/** The series of one pair, in the same three columns — what keeps a key alive. */
const pairSeries = (pair: ExhaustedPair): string => `${pair.role}\t${pair.thread}\t${pair.since}`;

/**
 * A DRIFT THE BOX IS STANDING ON, PAST THE BAND, AS THE COURIER CARRIES IT (thread 044).
 *
 * Everything here is MEASURED BY THE DAEMON and read off `daemon-drift.json`: the courier
 * composes, it does not re-derive. `why` is the daemon's own refusal sentence — the reason
 * lives in a verdict over leases, holds, flags and a working tree that only the daemon holds
 * (see `DriftStandoff`), and a second implementation of a safety rule in the courier is the
 * shape this package refuses everywhere else.
 */
export type CodeDriftAlarm = {
  /** The loaded code and what the ref resolves to — the two SHAs, short, as they are shown. */
  readonly sha: string;
  readonly refSha: string;
  /** The ref as it was named on the command line, so the reader knows what is being judged. */
  readonly ref: string;
  /** How far behind and for how long, already rendered — one phrase, one author. */
  readonly size: string;
  /** The daemon's refusal, verbatim. */
  readonly why: string;
  /**
   * WHEN THE DRIFT BEGAN, AND THE IDENTITY OF THE EVENT. Not the target SHA: on a repository
   * that merges several times an hour a key of "what the ref is now" would ring at every
   * merge for as long as the box stayed behind, which is the noise that teaches a reader to
   * skip the class. What the reader is owed is ONE call per period of being behind, and a box
   * that catches up and falls behind again begins a new period with a new stamp.
   */
  readonly since: string;
};

/** What was announced last run: the six classes of event in one file. */
export type NotifyState = {
  readonly waiting: readonly WaitingPair[];
  readonly stalled: readonly StalledTurn[];
  readonly parked: readonly ParkedThread[];
  /** The {@link authAlarmKey} of the authorisation shelf already announced, if any. */
  readonly auth?: string | undefined;
  /** The stamp of the merge-ready outage already announced, if any. */
  readonly gh?: string | undefined;
  /** The {@link CodeDriftAlarm.since} of the drift already announced, if any. */
  readonly drift?: string | undefined;
  /**
   * The {@link freezeKey}s already announced, for every series that is STILL RUNNING
   * (thread 013). Unlike every other class here this one is not the current composition:
   * it is what was said, carried forward for as long as the series it was said about
   * lives — which is the whole repair, because the pair itself disappears from the frozen
   * set at every thaw and a composition-shaped memory would forget it there.
   */
  readonly freezes?: readonly string[] | undefined;
  /**
   * The unaccepted turns already announced (thread 042) — the composition, like `stalled`
   * and unlike `freezes`: an untaken turn ends by being taken, and being taken is exactly
   * what drops it from the composition the caller hands over, so there is nothing to carry
   * forward. Absent means "this box has never announced one", which is what a state file
   * written before this class existed says, and it must not read as "everything is new".
   */
  readonly unaccepted?: readonly UnacceptedTurn[] | undefined;
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
   * THE UNTAKEN TURNS IN FORCE NOW (thread 042), explained and unexplained alike, ordered —
   * this is what the state file becomes, and what the courier's standing clause counts.
   */
  readonly unaccepted: readonly UnacceptedTurn[];
  /**
   * The subset the box can name NO reason for. It is the defect; the rest is the queue
   * behaving as the operator already knows it behaves, and is printed, not rung.
   */
  readonly unexplained: readonly UnacceptedTurn[];
  /** Unexplained turns not announced before — the ones that ring in this letter. */
  readonly freshUnaccepted: readonly UnacceptedTurn[];
  /**
   * Parks not announced before AND asking something — the same rule, keyed by the message that
   * parked, and the ONLY parks that produce a line: a park in force but already announced is
   * silent from the second digest on, and one declared by an informational message is silent
   * from the first.
   */
  readonly freshParked: readonly ParkedThread[];
  /**
   * THE PARKS IN FORCE THAT ARE ASKING A HUMAN — all of them, announced or not.
   *
   * It exists because the courier's line said `N parked, K of them asking` and put
   * {@link freshParked} into K, which is "asking AND not announced before". The two agree only
   * on the tick a park is born: from the second digest on, a live question standing on a person
   * printed `0 of them asking` — the line of 2026-08-21 (thread 030, defect Д-1), read in the
   * same hour a human was hunting a call that had not reached them. A count whose word and
   * whose number say different things is worse than no count: it is what an operator reads to
   * decide there is nothing to look for.
   */
  readonly askingParked: readonly ParkedThread[];
  /**
   * THE PARKS IN FORCE THAT THIS NOTIFIER CANNOT CALL ANYBODY ABOUT (thread 031) — the ones
   * whose person is not a `direct` target (no `wake.mode: 'self'` in the config, or not an
   * active role at all), asking or not.
   *
   * They are in NONE of the four numbers above, and that is the point of the field: the filter
   * that drops them used to run before the counters, so a question standing on an unreachable
   * person printed `0 parked, 0 of them asking, 0 of those new` — the same sentence as an empty
   * mail. The courier owes the reader the difference, and it owes it in the LINE it prints
   * every tick rather than in a call: whom to ring instead of the named person is a decision
   * about the norm, and no count may take it.
   */
  readonly unaddressedParked: readonly ParkedThread[];
  /**
   * THE PARKS THAT SAID THEIR QUESTION AGAIN — a line in the letter, never a letter of their
   * own (thread 030, defect Д-2).
   *
   * A park whose key was already announced but whose message has moved: the same person, the
   * same thread, a new parking message. In the field this is not a new question but the SAME
   * one re-asked — the park was lifted by somebody else's move, the raised role found the
   * question unanswered and wrote it out again. It used to be a second call.
   *
   * It is not silence either, and that is deliberate: this class is neighbour to Д-1, where a
   * live question vanished from every number the courier printed, and swapping noise for a
   * miss is the trade of thread 051 made backwards. So the repeat is DOWNGRADED rather than
   * dropped — it produces a line, and the line rides in whatever letter is already going out
   * for a fresh event. It never triggers a delivery by itself: see the send condition in
   * `notify --write`, which reads the `fresh*` counts and not the message.
   */
  readonly restatedParked: readonly ParkedThread[];
  /**
   * THE PARKS THAT WERE ANNOUNCED AND HAVE BEEN LIFTED — a line, never a call
   * (thread 030, defect (в2), decision of john «ОБА» of 2026-08-22).
   *
   * Until (в1) of the same day a park was lifted by the FIRST message that moved anybody
   * (`standingParkOf`, R27), and the message that lifted it was very often not an answer: the
   * merge notifier of some PR, a courier's report, a role's handover. From that instant
   * `parkingOf` returned nothing and the thread fell out of the courier's composition ENTIRELY
   * — not out of the call, out of all three numbers. The unanswered question stopped existing
   * for the signal layer. Measured in the field on 2026-08-22: eight live parks of john in
   * `.orchestrator/notify.state` and the one thread whose question had just been asked (030) in
   * none of them, its park lifted by an automatic `github` message nobody wrote.
   *
   * So the disappearance is NAMED. It rings for nothing — john's own word: "an unanswered
   * question to a person lives as a LINE of the digest rather than vanishing from the
   * composition" — and it rides in whatever letter is already going out, exactly like
   * {@link restatedParked}.
   *
   * WHAT (в1) OF THE SAME DAY CHANGED HERE IS THE WORDS AND NOT THE MECHANISM. The price of
   * this class used to be named as "the courier cannot tell the delivery of john's answer from
   * somebody else's move" — true of the wide lift, and false since a person park lifts on
   * `delivers: <that person>` alone. The class did not empty out: a park also stops standing
   * when a LATER park is declared in the same thread, and the state remembers a key whose thread
   * has moved on. What it stopped being is a class of accidents — so the line states the fact it
   * measured (the key rang and no longer stands) and claims nothing about the answer. See
   * {@link liftedPrefix} for the sentence itself.
   */
  readonly liftedParked: readonly ParkedThread[];
  /**
   * THE PARKED COMPOSITION AS THE STATE MUST HOLD IT WHEN THIS RUN SAYS NOTHING.
   *
   * Identical to {@link parked} except for the {@link restatedParked}, which keep the stamp
   * that was ANNOUNCED rather than the one in force. Without it the downgrade of Д-2 would be
   * a disappearance: the courier ticks every few minutes, the quiet tick after a restatement
   * would record the new stamp as told, and the line would be owed to a letter that never
   * learns it. A restated park therefore stays pending until a letter actually carries it.
   *
   * THE {@link liftedParked} ARE HELD HERE FOR THE SAME REASON AND AT A HIGHER PRICE: they are
   * no longer in the composition at all, so a quiet tick that wrote {@link parked} would forget
   * the key and the line would be owed to nobody — the repair would swap one silent miss for
   * another. They stay in the state, with the stamp that was announced, until a letter actually
   * carries the line; the letter's own write uses {@link parked} and drops them, which is what
   * makes the line happen exactly once.
   */
  readonly parkedIfSilent: readonly ParkedThread[];
  /** The authorisation shelf in force now, if the predicate rings — also part of the state. */
  readonly auth?: AuthAlarm | undefined;
  /** The merge-ready outage in force now, if the predicate rings — also part of the state. */
  readonly gh?: GhAlarm | undefined;
  /** The overdue drift in force now, if there is one — also part of the state. */
  readonly drift?: CodeDriftAlarm | undefined;
  /**
   * The pairs standing at the attempt ceiling right now, ordered — the STANDING count of
   * the courier line and of the `status` frame, printed every tick whether it is news or
   * not (thread 013): rounds 2 and 3 of a backoff do not ring, and this is where they are
   * nonetheless visible to whoever looks.
   */
  readonly exhausted: readonly ExhaustedPair[];
  /** The freeze announcements this run makes — at most one per series per kind. */
  readonly freshFreezes: readonly FreezeEvent[];
  /** Every freeze key that must survive into the next state file — see {@link NotifyState}. */
  readonly freezeKeys: readonly string[];
  /** True when this shelf has not been announced yet: ONE DELIVERY PER SHELF, not per tick. */
  readonly freshAuth: boolean;
  /** True when this run of refusals has not been announced yet — same rule, same reason. */
  readonly freshGh: boolean;
  /** True when this period of being behind has not been announced yet — one call per period. */
  readonly freshDrift: boolean;
  /** The message, one line per thread-and-human. Rendered from the FULL composition. */
  readonly lines: readonly NotificationLine[];
};

const key = (pair: WaitingPair): string => `${pair.role}\t${pair.thread}`;
const stalledKey = (turn: StalledTurn): string => `${turn.role}\t${turn.thread}\t${turn.since}`;
/**
 * THE IDENTITY OF A PARK FOR THE COURIER: THE PAIR (person, thread), AND NOT THE STAMP
 * (thread 030, defect Д-2).
 *
 * The stamp used to be part of it, and the reasoning was sound on its face — "a thread
 * answered and parked again is a NEW question". What it did not survive is the way a park
 * is LIFTED: any later message that moves somebody lifts it ({@link standingParkOf}), so a
 * role raised on a thread with its question still unanswered re-asks it in a new message,
 * the stamp moves, and the same question rang a second time. Measured in the field on
 * 2026-08-21/22: two calls about aco-028 and two about LLE-102, one question each.
 *
 * Keying by the pair costs nothing the stamp was buying, and that is a measurement rather
 * than a hope: THE COURIER'S MEMORY OF PARKS IS THE CURRENT COMPOSITION, NOT A JOURNAL
 * ({@link NotifyState}). A park that is lifted disappears from the state file on the very
 * next tick, so the next park of the same pair is fresh again and rings — the swallowed
 * second question that the stamp was there to prevent needs the lift and the new park to
 * fall inside ONE tick window, and even then the question is not lost: it is downgraded to
 * a line ({@link NotificationPlan.restatedParked}) rather than a call.
 */
const parkedKey = (park: ParkedThread): string => `${park.person}\t${park.thread}`;

/**
 * How a park that has changed its message under an unchanged key is said — the PACKAGE's
 * own words around the project's sentence, for the reason the box alarms are the package's
 * ({@link BOX_ALARM_KINDS}): the KEYS of the template map are part of the frozen config
 * shape, and a new slot for this would cost a protocol version and a migration in every box
 * in the field. What the project words is the question; what the package words is the one
 * fact the project cannot know — that this is the same question said again.
 */
const restatedPrefix = "still standing, asked again (not a new question): ";

/**
 * How a park that was LIFTED is said — the package's own words for the same reason
 * {@link restatedPrefix} is the package's, and saying the one fact the project's sentence
 * cannot: that this thread is no longer frozen behind the reader, and that this is the last
 * the digest will say about the question it was frozen on.
 *
 * It must not read like a fresh call ("your decision: …" alone) — the statement of (в2) says
 * so in as many words — because a reader who cannot tell "the circuit is holding this for you"
 * from "this has left the composition" is being taught to skip both.
 *
 * THE WORDS STOPPED CLAIMING THE ANSWER WAS NOT NAMED (thread 030, (в1), 2026-08-22). They used
 * to read "the park was lifted with no answer named, the question stands", and under the wide
 * lift that was the common case. Since the person park lifts on `delivers: <that person>` and on
 * nothing else, the sentence prints in the case where the answer WAS named — by the very field
 * that lifted the park. The mechanism did not move an inch (the key stays owed until a letter
 * carries it, the line rings for nobody, a closed thread is silent); what moved is the claim the
 * courier is entitled to make. It states what it measured — the key rang and has stopped
 * standing — and leaves "was it answered" to the reader, who can open the thread.
 */
const liftedPrefix = "the park was lifted, the last line about the question: ";

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
    // THE STAMP IS STILL WRITTEN, though it is no longer part of the key (thread 030): it is
    // what tells a park re-declared under the same key from one standing untouched, and that
    // difference is the whole of the downgrade "call → line". The line keeps its four columns.
    ...state.parked.map((park) => `parked\t${park.person}\t${park.thread}\t${park.since}`),
    // The two box-wide events are one line each and carry only their identity: what
    // identifies them is the shelf and the run of refusals, and the rest is re-read from
    // the journal and the outage file every time. The auth key is itself two columns
    // (account, stamp), so its line is three — see {@link authAlarmKey}.
    ...(state.auth === undefined ? [] : [`auth\t${state.auth}`]),
    ...(state.gh === undefined ? [] : [`gh\t${state.gh}`]),
    // The drift is one line and carries its stamp only, on the same rule: the size and the
    // reason are re-read from the box every time, and what identifies the event is when the
    // box first fell behind.
    ...(state.drift === undefined ? [] : [`drift\t${state.drift}`]),
    // A freeze line is the announcement itself, not the pair: `freeze <kind> <role>
    // <thread> <since>`. Sorted so that a diff of the file stays readable when several
    // pairs freeze in one storm — which is what a 529 storm does.
    ...[...(state.freezes ?? [])].sort().map((entry) => `freeze\t${entry}`),
    // Four columns, like a stall and for the same reasons: the age changes every tick and
    // the reason is re-read from the box every time, so what is written is the identity.
    ...(state.unaccepted ?? []).map((turn) => `unaccepted\t${unacceptedKey(turn)}`),
  ];
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
};

export const parseNotifyState = (raw: string): NotifyState => {
  const waiting: WaitingPair[] = [];
  const stalled: StalledTurn[] = [];
  const parked: ParkedThread[] = [];
  const freezes: string[] = [];
  const unaccepted: UnacceptedTurn[] = [];
  let auth: string | undefined;
  let gh: string | undefined;
  let drift: string | undefined;
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
    if (columns[0] === "unaccepted") {
      const [, role, thread, since] = columns;
      if (role !== undefined && thread !== undefined && since !== undefined) {
        // Neither the age nor the reason is stored — the first changes every tick and the
        // second is a fact about the box now, not about the announcement then.
        unaccepted.push({ role, thread, since, age: "" });
      }
      continue;
    }
    if (columns[0] === "auth") {
      // TWO COLUMNS IS THE PRE-B.4 FORM, and it reads as the box's own account rather than
      // as an unparsable line: a box that wrote it had one login, and that login is what
      // every one of its shelves was. Read as "no shelf announced" instead, the first run
      // after an upgrade would re-ring an alarm the operator was already told about.
      const [, second, third] = columns;
      if (third !== undefined) auth = `${second}\t${third}`;
      else if (second !== undefined) auth = `${BOX_ACCOUNT}\t${second}`;
      continue;
    }
    if (columns[0] === "gh") {
      if (columns[1] !== undefined) gh = columns[1];
      continue;
    }
    if (columns[0] === "drift") {
      if (columns[1] !== undefined) drift = columns[1];
      continue;
    }
    if (columns[0] === "freeze") {
      // Four columns exactly (kind, role, thread, since) — a short line is dropped rather
      // than half-read: a key that is not the key announces the same freeze a second time.
      const [, kind, role, thread, since] = columns;
      if (
        (kind === "exhausted" || kind === "frozen") &&
        role !== undefined &&
        thread !== undefined &&
        since !== undefined
      ) {
        freezes.push(`${kind}\t${role}\t${thread}\t${since}`);
      }
      continue;
    }
    const [role, thread] = columns;
    if (role !== undefined && thread !== undefined) waiting.push({ role, thread });
  }
  // An empty set is ABSENT rather than empty: the state of a box that has never frozen a
  // pair must read exactly as it did before this field existed.
  return {
    waiting,
    stalled,
    parked,
    auth,
    gh,
    drift,
    ...(freezes.length === 0 ? {} : { freezes }),
    ...(unaccepted.length === 0 ? {} : { unaccepted }),
  };
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
   * EVERY PERSON-PARK DECLARED IN AN OPEN THREAD — the standing ones and the lifted ones alike
   * (thread 030, (в2)). It is what {@link NotificationPlan.liftedParked} is read from: the
   * state remembers a pair and a stamp, and the question and the `asks` of that stamp live
   * only in the feed the caller is holding (`personParksOf`).
   *
   * ABSENT MEANS SILENT, and that is the safe direction rather than an oversight: a caller
   * that does not hand over the declarations cannot be told apart from a mail where every
   * park was lifted, and inventing lines for keys nobody can read back would announce a
   * question in the words of nobody. A CLOSED thread contributes nothing here, which is how
   * "a closed thread produces no line" is enforced — closing is the acceptance.
   */
  readonly declaredParks?: readonly ParkedThread[];
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
  /**
   * The box has been behind its own ref past {@link CODE_DRIFT_OVERDUE_MINUTES} and has
   * named why it is not pulling (thread 044). The caller reads the daemon's published
   * standoff and applies the threshold; this picks whether it rings. Absent means either no
   * drift or one inside the band — and inside the band it is deliberately silent: a box that
   * is one merge behind for twenty minutes is a working circuit, not an event.
   */
  readonly drift?: CodeDriftAlarm | undefined;
  /**
   * Pairs whose attempt counter has reached the ceiling and has not been reset since
   * (thread 013) — the whole series set, INCLUDING the ones currently thawed or running,
   * which the caller reads off `LeaseView.exhaustedSince`. Passing only the pairs frozen
   * at this instant would be the free path curator named: the memory would be dropped in
   * every thaw gap and the same series would ring on every round of its backoff.
   */
  readonly exhausted?: readonly ExhaustedPair[];
  /**
   * Pairs whose turn this box has been sitting on past {@link UNACCEPTED_AFTER_MINUTES}
   * (thread 042) — the caller measures the age, reads the leases and names the reason it
   * knows; this picks which of them ring. Absent means the caller could not read the box's
   * own state at all (a mail-only invocation), and silence is the honest answer there: with
   * no journal there is no way to tell an untaken turn from one taken a second ago.
   */
  readonly unaccepted?: readonly UnacceptedTurn[];
  readonly templates?: Partial<Record<NotificationKind, string>>;
}): NotificationPlan => {
  const byRole = new Map(input.targets.map((target) => [target.id, target]));
  const waiting = ordered(input.waiting.filter((pair) => byRole.has(pair.role)));
  const seen = new Set(input.seen.waiting.map(key));
  const fresh = waiting.filter((pair) => !seen.has(key(pair)));

  // A park is only an event for the person it names, and only if that person is one of
  // the targets: "parked on somebody the notifier does not write to" is not a call.
  const parksInForce = [...(input.parked ?? [])].sort((a, b) => a.thread.localeCompare(b.thread));
  const parked = parksInForce.filter((park) => byRole.get(park.person)?.style === "direct");
  // AND THE PARKS IT WILL NOT CALL DO NOT VANISH ON THE WAY (thread 031). The filter above used
  // to be the END of them — they were dropped BEFORE the counters, so `N parked, K of them
  // asking, M of those new` printed three zeros in two different worlds: "no question is
  // standing" and "a question is standing on somebody this notifier cannot reach". The second
  // world is the one thread 030 was about, and a courier's line that cannot tell it from the
  // first is the sentence an operator reads to decide there is nothing to look for.
  //
  // They are counted APART rather than folded into the three numbers, and they produce NO LINE:
  // those numbers describe THE CALL in its three tenses (in force / asking / rang this tick),
  // and a park whose addressee is unreachable has no tense in that verb — while ringing
  // somebody ELSE about a question addressed to a person would be a new rule about who is
  // called for whom, which is a norm and not a count, and this repair does not invent one.
  const unaddressedParked = parksInForce.filter(
    (park) => byRole.get(park.person)?.style !== "direct",
  );
  const seenParks = new Map(input.seen.parked.map((park) => [parkedKey(park), park.since]));
  // A PARK IS AN EVENT, NOT A STATE, FOR THE COURIER (thread 051): it rings on the message
  // that asked, once, and the composition below keeps it only so that the age pass stays
  // quiet about it and the state remembers it was told. `asks` is the message's own word:
  // `expects: none` says it wants nothing of anybody, and ❓ over it is a lie by mark.
  const askingParked = parked.filter((park) => park.asks);
  const freshParked = askingParked.filter((park) => !seenParks.has(parkedKey(park)));
  // THE REPEAT, TOLD FROM THE FIRST TELLING BY THE STAMP AND BY NOTHING ELSE (thread 030,
  // Д-2). An informational re-park is not here for the same reason it is not in `freshParked`:
  // `asks` is the message's own word, and 016 re-declared its park daily asking nothing.
  const restatedParked = askingParked.filter((park) => {
    const announced = seenParks.get(parkedKey(park));
    return announced !== undefined && announced !== park.since;
  });
  const restatedKeys = new Set(restatedParked.map(parkedKey));
  // THE PARK THAT WAS ANNOUNCED AND IS NO LONGER THERE (thread 030, (в2)). The key is the pair,
  // as everywhere since Д-2; the DECLARATION is found by the pair AND the announced stamp,
  // because that is the message whose question was told and whose `asks` decides whether
  // anything was ever asked. A key that finds no declaration says nothing: the thread was
  // closed (the acceptance), or its feed no longer carries that message — and a line put
  // together out of a key alone would name a question nobody wrote.
  const standingKeys = new Set(parked.map(parkedKey));
  const declared = new Map(
    (input.declaredParks ?? []).map((park) => [`${parkedKey(park)}\t${park.since}`, park]),
  );
  const liftedParked = input.seen.parked
    .filter((park) => !standingKeys.has(parkedKey(park)))
    .flatMap((park) => {
      const at = declared.get(`${parkedKey(park)}\t${park.since}`);
      // `asks` is the message's own word here as it is in `freshParked`: a park declared by an
      // informational message asked nobody for anything, so its lift owes nobody a line.
      return at === undefined || !at.asks ? [] : [at];
    })
    .filter((park) => byRole.get(park.person)?.style === "direct")
    .sort((a, b) => a.thread.localeCompare(b.thread));
  const parkedIfSilent = [
    ...parked.map((park) => {
      const announced = restatedKeys.has(parkedKey(park))
        ? seenParks.get(parkedKey(park))
        : undefined;
      return announced === undefined ? park : { ...park, since: announced };
    }),
    ...liftedParked,
  ];

  // A PARKED THREAD IS NEVER ALSO A STALLED ONE (thread 023). Both would be true of it —
  // the turn is not moving, by construction — but "your decision is wanted, here is the
  // question" and "nobody is moving this" are opposite instructions, and it was the second
  // one, printed about threads the circuit was chewing, that made the digest unreadable.
  const told = new Set([
    ...waiting.map((pair) => pair.thread),
    ...parked.map((p) => p.thread),
    ...(input.frozen ?? []),
  ]);
  // AN UNTAKEN TURN IS NOT A PARK AND NOT A FREEZE (thread 042, check (в)): those classes own
  // their threads, and two lines about one id is the noise thread 023 removed.
  //
  // BUT `told` IS THE WRONG SET FOR IT, in both of its halves, and this is the whole finding of
  // §1 of 2026-08-29:
  //
  //  - a thread in `waiting` has been ANNOUNCED TO THE ROLE, which is the opposite of raised.
  //    "Your turn: 042" going out every tick while no session is ever started is precisely the
  //    silence measured — the mail is impeccable and the box does nothing — so a class silenced
  //    by its own turn-notification could never fire in the field;
  //  - a park covers THE TURN IT WAS DECLARED ON. `parksInForce` rather than `parked` is what
  //    covers a pair (a park addressed to a person this box cannot call still freezes the
  //    thread), and a park whose `holder` names another role covers nothing here: the pair that
  //    inherited it is not waiting for a human, it is waiting to be raised.
  const parksByThread = new Map<string, ParkedThread[]>();
  for (const park of parksInForce) {
    const at = parksByThread.get(park.thread);
    if (at === undefined) parksByThread.set(park.thread, [park]);
    else at.push(park);
  }
  const frozenIds = new Set(input.frozen ?? []);
  const unaccepted = [...(input.unaccepted ?? [])]
    .filter((turn) => !frozenIds.has(turn.thread))
    .flatMap((turn): UnacceptedTurn[] => {
      const parks = parksByThread.get(turn.thread) ?? [];
      if (parks.length === 0) return [turn];
      // A park with no holder of its own is the pre-042 park and keeps its old power over the
      // whole thread: nothing in the feed says whose turn it was declared on, and guessing
      // would turn every legitimate park in the field into an alarm on the day this ships.
      if (parks.some((park) => park.holder === undefined || park.holder === turn.role)) return [];
      return [{ ...turn, staleParkOn: parks[0]?.person }];
    })
    .sort((a, b) => a.thread.localeCompare(b.thread) || a.role.localeCompare(b.role));
  const unexplained = unaccepted.filter((turn) => turn.reason === undefined);
  // THE CLASS CAN ONLY TAKE THE STALL'S PLACE WHERE IT CAN SPEAK (thread 042). Its call is
  // "go and look at the daemon", which is an instruction only a person at the machine can
  // carry out, so a box with no `direct` target rings nothing here — and on such a box the
  // precedence below would REMOVE a line and put none in its stead. Measured on the daemon's
  // own fixture (`daemon.process.test.ts`, thread 024): a pair standing 34 days lost its
  // `012-x (stalled 34d 16h)` and gained silence, which is the defect this thread is about.
  const canSpeak = input.targets.some((target) => target.style === "direct");
  const unacceptedIds = new Set(canSpeak ? unaccepted.map((turn) => turn.thread) : []);
  // AND IT TAKES PRECEDENCE OVER THE STALL, rather than standing beside it (thread 042,
  // check (д)). Both are true of a pair standing three hours untaken — the 180-minute pass
  // sees exactly the same thread — but "nobody is moving this" is the vaguer of the two
  // sentences and the one that cost john four hand-found cases: the untaken line names the
  // role, the age AND the fact that the box has nothing against the pair.
  const stalled = [...(input.stalled ?? [])]
    .filter((turn) => !told.has(turn.thread) && !unacceptedIds.has(turn.thread))
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
  // AND THE DRIFT GOES WITH THEM. "The circuit is executing something other than what was
  // merged" is a fact only somebody with access to the machine can act on, and a chat
  // assistant told about it can do exactly nothing with it.
  const drift = human ? input.drift : undefined;
  // THE EIGHTH CLASS IS THE BOX'S OWN AND IS DROPPED WITH THE OTHERS WHEN NOBODY HUMAN IS
  // CONFIGURED (thread 042): "go and look at the daemon" is an instruction only a person at
  // the machine can carry out. The composition survives the drop — the state still records
  // what stands — but nothing rings.
  const seenUnaccepted = new Set((input.seen.unaccepted ?? []).map(unacceptedKey));
  const freshUnaccepted = human
    ? unexplained.filter((turn) => !seenUnaccepted.has(unacceptedKey(turn)))
    : [];
  const freshAuth = auth !== undefined && authAlarmKey(auth) !== input.seen.auth;
  const freshGh = gh !== undefined && gh.since !== input.seen.gh;
  const freshDrift = drift !== undefined && drift.since !== input.seen.drift;

  // THE SIXTH CLASS (thread 013). Two decisions live here and neither is a detail:
  //
  //  - THE MEMORY IS KEYED BY THE SERIES AND CARRIED FORWARD, not rebuilt from the set of
  //    pairs frozen at this instant. `liveSeries` is what keeps a key alive, and a series
  //    ends the only way it can — a delivery resets the counter, the caller stops passing
  //    the pair, the key is dropped and the next freeze of that pair rings again;
  //  - A PAIR IN THE GAP RINGS FOR NOTHING. Between the thaw and the next failure there is
  //    no freeze in force (`failureClass` absent), and there is nothing to say about it
  //    that the standing counters do not already print every tick.
  const series = [...(input.exhausted ?? [])].sort(
    (a, b) => a.thread.localeCompare(b.thread) || a.role.localeCompare(b.role),
  );
  const liveSeries = new Set(series.map(pairSeries));
  const seenFreezes = new Set(input.seen.freezes ?? []);
  const freshFreezes: FreezeEvent[] = [];
  // A FREEZE IS DROPPED WHEN NOBODY HUMAN IS CONFIGURED, for the reason the two box-wide
  // alarms are: `frozen` is an instruction to a person, and `exhausted` is a fact about the
  // machine — an assistant poked through a chat can act on neither.
  if (human) {
    for (const pair of series) {
      if (pair.failureClass === undefined) continue;
      // THE TWO EVENTS ARE TOLD APART BY THE THAW AND BY NOTHING ELSE: a freeze with a
      // stamp ahead of it ends by itself, one without a stamp does not — which is true of
      // a substantive freeze from its first second, and that is why the substantive class
      // rings ONCE, as `frozen`, and never as `exhausted`.
      const event: FreezeEvent = {
        kind: (pair.thaw ?? null) === null ? "frozen" : "exhausted",
        pair,
      };
      if (seenFreezes.has(freezeKey(event))) continue;
      freshFreezes.push(event);
    }
  }
  const freezeKeys = [
    ...[...seenFreezes].filter((entry) => liveSeries.has(seriesOf(entry))),
    ...freshFreezes.map(freezeKey),
  ];
  const exhausted = series.filter((pair) => pair.failureClass !== undefined);

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
        account: describeAccount(auth.account),
        deaths: String(auth.deaths),
        since: auth.since,
        until: auth.until,
        repair: auth.repair === undefined ? "" : ` (\`${auth.repair}\`)`,
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
  // AND THE DRIFT STANDS WITH THE TWO ABOVE, for the reason they are there at all: every
  // line below this one is about the mail, and a reader who learns "your turn: 044" first
  // and "this box is not running the code that was merged" last has read them in the wrong
  // order — the second fact changes what the first one means.
  //
  // IT IS THE FRESH ONE THAT PRINTS, like a park and unlike a turn: a drift does not go away
  // by itself while the window stays shut, and a line repeated every few minutes for hours is
  // the noise that costs the next real call its reader.
  if (drift !== undefined && freshDrift)
    lines.push({
      kind: "code-drift",
      thread: "",
      role: "",
      text: renderTemplate(BOX_ALARM_TEMPLATES["code-drift"], {
        sha: drift.sha,
        refSha: drift.refSha,
        ref: drift.ref,
        size: drift.size,
        why: drift.why,
      }),
    });
  // THE FREEZES COME WITH THE BOX'S OWN LINES, above the mail, for the same reason: a pair
  // the circuit has stopped raising is not a turn that has passed, and a reader who learns
  // "your turn: 042" first and "nothing is being raised for 042" last has read them in the
  // wrong order. Each freeze is its own line — two frozen pairs are two facts.
  for (const event of freshFreezes) {
    const detail = describeFreeze({
      failureClass: event.pair.failureClass ?? "substantive",
      thaw: event.pair.thaw ?? null,
    });
    lines.push({
      kind: event.kind,
      thread: event.pair.thread,
      role: event.pair.role,
      text: renderTemplate(BOX_ALARM_TEMPLATES[event.kind], {
        role: event.pair.role,
        thread: event.pair.thread,
        attempts: String(event.pair.attempts ?? ""),
        detail,
      }),
    });
  }
  // AND THE UNTAKEN TURNS STAND WITH THEM, above the mail, for the identical reason: a
  // reader who learns "your turn: 042" first and "the box is not raising 042" last has read
  // the two facts in the wrong order. One line per pair — two stuck pairs are two facts, and
  // one of them may be the only one the reader can do anything about.
  for (const turn of freshUnaccepted) {
    // Two texts, one class: what the reader has to DO differs (look at the box vs. move the
    // stale park), and a line that names the wrong move costs the same as no line.
    const kind: BoxAlarmKind =
      turn.staleParkOn === undefined ? "unaccepted" : "unaccepted-stale-park";
    lines.push({
      kind,
      thread: turn.thread,
      role: turn.role,
      text: renderTemplate(BOX_ALARM_TEMPLATES[kind], {
        role: turn.role,
        thread: turn.thread,
        age: turn.age,
        person: turn.staleParkOn ?? "",
      }),
    });
  }
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
  // AND THE REPEATS COME RIGHT AFTER THEM, in the one letter that was going out anyway
  // (thread 030, Д-2): same slot, same question, the package's own words saying it is the
  // same one. A reader who cannot tell a repeat from a new call has been given the noise back.
  for (const park of restatedParked) {
    lines.push({
      kind: "parked",
      thread: park.thread,
      role: park.person,
      text:
        restatedPrefix +
        renderTemplate(template("parked"), {
          thread: park.thread,
          question: park.question,
        }),
    });
  }
  // AND THE LIFTED ONES AFTER BOTH (thread 030, (в2)): the same slot again, because what the
  // reader is owed is the question in the words it was asked in — and the package's own
  // sentence in front of it, saying the one thing the project cannot know, that this question
  // is no longer holding the thread. It rides in a letter somebody else's event triggered; the
  // send condition in `notify --write` does not read this list, and that is the whole of "a
  // line, never a call".
  for (const park of liftedParked) {
    lines.push({
      kind: "parked",
      thread: park.thread,
      role: park.person,
      text:
        liftedPrefix +
        renderTemplate(template("parked"), {
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
    unaccepted,
    unexplained,
    freshUnaccepted,
    freshParked,
    askingParked,
    unaddressedParked,
    restatedParked,
    liftedParked,
    parkedIfSilent,
    exhausted,
    freshFreezes,
    freezeKeys,
    auth,
    gh,
    drift,
    freshAuth,
    freshGh,
    freshDrift,
    lines,
  };
};

/**
 * How long, in the words a human reads: "3h 20m", "2d 4h", "45m". Rounded down and
 * two units deep on purpose — the number is a reason to look, not a measurement.
 */
/**
 * WHICH WAITING PAIRS THE BOX HAS NOT TAKEN (thread 042) — pure, so that the four cases of
 * 2026-08-28 are fixtures and not a night of watching a live circuit.
 *
 * The caller hands over facts and nothing else: the turns standing on roles THIS box raises,
 * when each pair was last raised, which roles are busy right now, and the reasons the box
 * already knows. Every judgement is here.
 *
 * A ROLE THAT IS BUSY ELSEWHERE IS NOT A DEFECT (check (б) of the statement): one session per
 * role is the rule the daemon runs on, so a pair queued behind its own role's other thread is
 * the circuit working, and calling it a standstill would ring on every healthy busy hour.
 *
 * AND THE QUEUE COUNTS FOR NOTHING EVEN AFTER IT ENDS — the first field firing of this class,
 * 2026-08-29T02:53:11Z, was a FALSE call for exactly that reason. `curator×042` had the turn
 * from 02:39:31Z; `curator` held a lease on `026-codex-agent-kind` from 02:37:45Z to 02:52:31Z
 * and was raised on `042` at 02:53:17Z — six seconds after the tick that rang. The box asked
 * "is the role busy?" at the instant of the tick and "how old is the turn?" from the handoff,
 * so thirteen of those fourteen minutes were the legitimate queue of check (б) and were counted
 * anyway: the pair fell out of the queue with its whole age in hand, one tick before its own
 * raise, and john was told `no reason known` about a box that had two reasons and was doing its
 * job. Left alone it would ring on EVERY queue longer than the threshold — one slot per role
 * makes that the normal shape of a working day, and a digest that cries at a working day is the
 * noise that teaches its reader to stop opening it.
 *
 * So the age is judged on the part of the standing time the role was FREE: `busy` carries the
 * lease spans out of the same journal `raisedAt` is read from, their overlap with the standing
 * window is subtracted, and only what is left is measured against the threshold. The `age` in
 * the line stays the whole wall-clock standing time — that is the number a reader sees in the
 * feed and it must not disagree with it — and what the class asserts is the part underneath it:
 * this box had the pair raisable for over {@link UNACCEPTED_AFTER_MINUTES} and did not raise it.
 */
export const unacceptedTurns = (input: {
  /** One entry per open thread whose `waiting-on` names a role this box raises. */
  readonly turns: readonly {
    readonly role: RoleId;
    readonly thread: string;
    readonly since: string;
  }[];
  /** `role\tthread` → the stamp this pair was last raised at; absent — it never was. */
  readonly raisedAt: ReadonlyMap<string, string>;
  /** The roles holding a live lease right now — their queue is legitimate, not a standstill. */
  readonly busyRoles: ReadonlySet<RoleId>;
  /**
   * WHEN EACH ROLE WAS BUSY, closed spans out of the journal (`lease-acquired` → the
   * `lease-released` that answers it, a still-open lease closed at `now`). A pair cannot be
   * raised while its role holds a lease anywhere, so this is time the box was NOT free to take
   * the turn, and it is subtracted from the age before the threshold is applied. Absent — the
   * caller has no journal to fold, and the whole standing time is judged as free, which is what
   * this function did before the false call of 2026-08-29T02:53:11Z.
   */
  readonly busy?: readonly {
    readonly role: RoleId;
    readonly from: string;
    readonly to: string;
  }[];
  /** `role\tthread` → what the box knows is holding THIS pair back, in its own words. */
  readonly reasons?: ReadonlyMap<string, string>;
  /** What is holding back EVERY pair (launches disabled, the daemon stopped), if anything. */
  readonly hold?: string | undefined;
  readonly now: Date;
  readonly afterMinutes?: number;
}): readonly UnacceptedTurn[] => {
  const after = input.afterMinutes ?? UNACCEPTED_AFTER_MINUTES;
  const out: UnacceptedTurn[] = [];
  for (const turn of input.turns) {
    if (input.busyRoles.has(turn.role)) continue;
    const minutes = (input.now.getTime() - Date.parse(turn.since)) / 60_000;
    if (!Number.isFinite(minutes)) continue;
    // THE QUEUE IS SUBTRACTED, NOT JUST CHECKED AT THE TICK: a role that spent the turn's
    // whole age on its own other thread has queued legitimately, and the fact that the queue
    // ended a minute ago does not turn it into a standstill.
    if (minutes - queuedMinutes(input.busy ?? [], turn, input.now) < after) continue;
    // THE TURN WAS TAKEN IF A LEASE POSTDATES THE HANDOFF, and by that alone: a pair raised
    // yesterday, released and left standing since this morning is untaken, and a rule that
    // asked "was it ever raised" would call it healthy for good.
    const raised = input.raisedAt.get(`${turn.role}\t${turn.thread}`);
    if (raised !== undefined && Date.parse(raised) >= Date.parse(turn.since)) continue;
    const reason = input.reasons?.get(`${turn.role}\t${turn.thread}`) ?? input.hold;
    out.push({
      role: turn.role,
      thread: turn.thread,
      since: turn.since,
      age: describeAge(minutes),
      ...(reason === undefined ? {} : { reason }),
    });
  }
  return out;
};

/**
 * How much of a pair's standing time its role spent holding a lease — the legitimate queue,
 * in minutes. Spans of other roles are none of this pair's business, and a span is clipped to
 * the standing window at both ends: a lease taken before the handoff blocked nothing of this
 * turn, and a lease still open at `now` counts only up to `now`.
 */
const queuedMinutes = (
  busy: readonly { readonly role: RoleId; readonly from: string; readonly to: string }[],
  turn: { readonly role: RoleId; readonly since: string },
  now: Date,
): number => {
  const from = Date.parse(turn.since);
  const until = now.getTime();
  let queued = 0;
  for (const span of busy) {
    if (span.role !== turn.role) continue;
    const start = Math.max(Date.parse(span.from), from);
    const end = Math.min(Date.parse(span.to), until);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) queued += end - start;
  }
  return queued / 60_000;
};

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
