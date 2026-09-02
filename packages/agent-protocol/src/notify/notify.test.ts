/**
 * The notifier's core. Every test here is a property the bash predecessor had to
 * learn the hard way (threads 005, 008, 011) — they are carried over as tests
 * precisely because the reasons are not obvious from the code and would be
 * "simplified" away by whoever meets it next.
 */
import { describe, expect, it } from "vitest";
import type { LeaseView } from "../orchestrator/lease.js";
import type { NotificationTarget } from "../roles/registry.js";
import {
  type AccountAlarm,
  accountAlarmKey,
  announcedOf,
  describeAge,
  EVENT_PARK_STALE_AFTER_MINUTES,
  type EventPark,
  type ExhaustedPair,
  exhaustedPairsOf,
  type NotificationPlan,
  type NotifyState,
  type ParkedThread,
  type ParkReminder,
  parseNotifyState,
  planNotifications,
  renderAnnouncement,
  renderNotification,
  renderNotifyState,
  type StalledTurn,
  UNACCEPTED_AFTER_MINUTES,
  type UnacceptedTurn,
  unacceptedTurns,
  type WaitingPair,
} from "./notify.js";

const TARGETS: NotificationTarget[] = [
  { id: "john", style: "direct" },
  { id: "curator", style: "nudge", nudge: "john" },
];

const TEMPLATES = {
  turn: "⏳ твой ход: {thread}",
  "turn-with-nudge": "⏳ твой ход: {thread} ({nudged} следом)",
  nudge: "🔔 тред {thread} ждёт {role} — дёрни его ({via})",
} as const;

const EMPTY: NotifyState = { waiting: [], stalled: [], parked: [] };

const plan = (waiting: readonly WaitingPair[], seen: readonly WaitingPair[] = []) =>
  planNotifications({
    targets: TARGETS,
    waiting,
    seen: { waiting: seen, stalled: [], parked: [] },
    templates: TEMPLATES,
  });

describe("planNotifications — the trigger, the text and the unit", () => {
  it("the TRIGGER is a new pair: nothing new, nothing to send", () => {
    const seen = [{ role: "john", thread: "016-x" }];

    expect(plan([{ role: "john", thread: "016-x" }], seen).fresh).toEqual([]);
  });

  it("the TEXT is the full composition, not just the new pair", () => {
    // A list of one reads as "everything else is closed" — that would be a lie at
    // the price of a forgotten thread (thread 005).
    const result = plan(
      [
        { role: "john", thread: "003-old" },
        { role: "john", thread: "016-new" },
      ],
      [{ role: "john", thread: "003-old" }],
    );

    expect(result.fresh).toEqual([{ role: "john", thread: "016-new" }]);
    expect(renderNotification(result.lines)).toBe("⏳ твой ход: 003-old\n⏳ твой ход: 016-new");
  });

  it("the UNIT is a thread: a second thread for the same human is a second line", () => {
    const result = plan([
      { role: "john", thread: "003-a" },
      { role: "john", thread: "016-b" },
    ]);

    expect(result.lines).toHaveLength(2);
  });

  it("a thread waiting on BOTH is one line, and the slot says so", () => {
    // A thread waiting on a human and an assistant is a queue, not a parallel: the
    // human moves first. Two equal lines about one id made the reader ask which.
    const result = plan([
      { role: "john", thread: "016-x" },
      { role: "curator", thread: "016-x" },
    ]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.kind).toBe("turn-with-nudge");
    expect(result.lines[0]?.text).toBe("⏳ твой ход: 016-x (curator следом)");
  });

  it("a thread waiting only on an assistant asks the HUMAN to poke them", () => {
    // wake.mode = via-human: there is no session to wake, so the only action left is
    // a person opening a chat — and `via` names which person, instead of a hardcoded
    // "john" inside an awk program.
    const result = plan([{ role: "curator", thread: "016-x" }]);

    expect(result.lines[0]?.kind).toBe("nudge");
    expect(result.lines[0]?.text).toBe("🔔 тред 016-x ждёт curator — дёрни его (john)");
  });

  it("waits on roles that are NOT notification targets are dropped", () => {
    // "A thread waits on dev-core" is the watch's business, not a notification. The
    // caller passes the whole mail on purpose — the filter lives here, once.
    const result = plan([{ role: "dev-core", thread: "016-x" }]);

    expect(result.waiting).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it("the state is the FULL current composition, so a wait that went away comes back as new", () => {
    // The predecessor's property, kept: a thread that returns into the wait is a new
    // turn on it, and the second turn deserves the same message as the first.
    const first = plan([{ role: "john", thread: "016-x" }]);
    const gone = plan([], first.waiting);
    const again = plan([{ role: "john", thread: "016-x" }], gone.waiting);

    expect(gone.waiting).toEqual([]);
    expect(again.fresh).toEqual([{ role: "john", thread: "016-x" }]);
  });

  it("falls back to the package's English when the project says nothing", () => {
    const result = planNotifications({
      targets: TARGETS,
      waiting: [{ role: "john", thread: "016-x" }],
      seen: EMPTY,
    });

    expect(result.lines[0]?.text).toBe("your turn: 016-x");
  });

  it("the order is stable — by thread, then by role", () => {
    const result = plan([
      { role: "john", thread: "b" },
      { role: "curator", thread: "a" },
    ]);

    expect(result.waiting.map((pair) => pair.thread)).toEqual(["a", "b"]);
  });
});

describe("the state file", () => {
  it("round-trips", () => {
    const pairs = [
      { role: "curator", thread: "a" },
      { role: "john", thread: "b" },
    ];

    const state = { waiting: pairs, stalled: [], parked: [] };

    expect(parseNotifyState(renderNotifyState(state))).toEqual(state);
  });

  it("an empty composition is an empty file, and a missing one parses as nothing", () => {
    expect(renderNotifyState(EMPTY)).toBe("");
    expect(parseNotifyState("")).toEqual(EMPTY);
  });
});

describe("a turn that has not moved — the second class of event (thread 024)", () => {
  const STALLED = { thread: "027-x", role: "curator", since: "2026-07-28T09:00:00Z", age: "5h" };

  const withStall = (stalled: readonly StalledTurn[], seen: NotifyState = EMPTY) =>
    planNotifications({
      targets: TARGETS,
      waiting: [],
      seen,
      stalled,
      templates: { ...TEMPLATES, stalled: "⌛ {thread} стоит {age} — ход у {role}" },
    });

  it("rings about a stall even though NO human is in waiting-on — the v13 case", () => {
    // Since v13 john is never named in the field, so the first question ("who is
    // awaited") produces nothing for him. This is the whole point of the second one.
    const result = withStall([STALLED]);

    expect(result.freshStalled).toEqual([STALLED]);
    expect(renderNotification(result.lines)).toBe("⌛ 027-x стоит 5h — ход у curator");
  });

  it("does not repeat a stall it has already announced", () => {
    const first = withStall([STALLED]);
    const again = withStall([STALLED], { waiting: [], stalled: first.stalled, parked: [] });

    expect(again.freshStalled).toEqual([]);
    expect(again.lines).toHaveLength(1); // still SAID, only not counted as new
  });

  it("a fork that moves and stalls AGAIN is a new event — the key is the handoff", () => {
    const first = withStall([STALLED]);
    const later = withStall([{ ...STALLED, since: "2026-07-28T14:00:00Z", age: "3h" }], {
      waiting: [],
      stalled: first.stalled,
      parked: [],
    });

    expect(later.freshStalled).toHaveLength(1);
  });

  it("a thread the human is already told about is not also reported as stalled", () => {
    const result = planNotifications({
      targets: TARGETS,
      waiting: [{ role: "john", thread: "027-x" }],
      seen: EMPTY,
      stalled: [{ ...STALLED, role: "john" }],
      templates: TEMPLATES,
    });

    expect(result.stalled).toEqual([]);
    expect(result.lines).toHaveLength(1);
  });

  it("the state file carries stalls beside waits, and an old two-column file still parses", () => {
    const state = {
      waiting: [{ role: "john", thread: "b" }],
      stalled: [{ ...STALLED, age: "" }],
      parked: [],
    };

    expect(parseNotifyState(renderNotifyState(state))).toEqual(state);
    expect(parseNotifyState("john\tb\n")).toEqual({
      waiting: [{ role: "john", thread: "b" }],
      stalled: [],
      parked: [],
    });
  });
});

describe("describeAge — a reason to look, not a measurement", () => {
  it("counts down to the unit a human reads", () => {
    expect(describeAge(45)).toBe("45m");
    expect(describeAge(200)).toBe("3h 20m");
    expect(describeAge(120)).toBe("2h");
    expect(describeAge(60 * 52)).toBe("2d 4h");
    expect(describeAge(60 * 48)).toBe("2d");
  });
});

describe("announcements — the same mechanism, a thread as the reader", () => {
  it("uses the project's text when it has one", () => {
    expect(
      renderAnnouncement({
        kind: "force-stop",
        variables: { thread: "016-x", by: "john", reason: "quota" },
        templates: { "force-stop": "Остановлено ({by}) по треду {thread}: {reason}" },
      }),
    ).toBe("Остановлено (john) по треду 016-x: quota");
  });

  it("keeps the package's English when it does not", () => {
    expect(
      renderAnnouncement({
        kind: "force-stop",
        variables: { thread: "016-x", by: "john", reason: "quota" },
      }),
    ).toBe("The session on thread 016-x was force-stopped (by john): quota");
  });
});

describe("a thread frozen behind a person — the third class of event (thread 023)", () => {
  const PARKED = {
    thread: "023-x",
    person: "john",
    since: "2026-07-31T11:08:20Z",
    question: "Перезапустить демон и посмотреть, встал ли скип parked?",
    asks: true,
  };
  const PARK_TEMPLATE = { ...TEMPLATES, parked: "❓ {thread} ждёт твоего решения: {question}" };

  const withPark = (parked: readonly ParkedThread[], seen: NotifyState = EMPTY, rest = {}) =>
    planNotifications({
      targets: TARGETS,
      waiting: [],
      seen,
      parked,
      templates: PARK_TEMPLATE,
      ...rest,
    });

  it("rings with NO age threshold, and the line carries the question", () => {
    // The live case behind the requirement: a park written at 11:08 would have stayed
    // silent until 14:08 under the age rule — the watchdog read nothing but the age.
    const result = withPark([PARKED]);

    expect(result.freshParked).toEqual([PARKED]);
    expect(renderNotification(result.lines)).toBe(
      "❓ 023-x ждёт твоего решения: Перезапустить демон и посмотреть, встал ли скип parked?",
    );
  });

  it("does not repeat a park it has already announced — and prints NOTHING about it", () => {
    // THE ECHO (thread 051, john's pain of 2026-08-03): the line used to be rendered from the
    // composition, so an unchanged park was repeated in every digest that had anything else
    // to say — measured live on 016 (a park held as a mode) and 049 (a park over two manual
    // operations, its questions already closed). ❓ has to mean "a question you have not read".
    const first = withPark([PARKED]);
    const again = withPark([PARKED], { waiting: [], stalled: [], parked: first.parked });

    expect(again.freshParked).toEqual([]);
    expect(again.lines).toEqual([]);
    // The park is still IN FORCE: the composition (and so the state, and so the silence of
    // the age pass about this thread) is unchanged — only the call is not repeated.
    expect(again.parked).toEqual([PARKED]);
    // AND IT IS STILL A QUESTION STANDING ON A HUMAN (thread 030, Д-1). The courier's line
    // counted `freshParked` under the word "asking", so it said `0 of them asking` about
    // exactly this state — a live question, silent only because it had already rung once.
    expect(again.askingParked).toEqual([PARKED]);
  });

  it("a park that asks nothing is not counted as asking either — the word means the message", () => {
    const result = withPark([{ ...PARKED, asks: false }]);

    expect(result.askingParked).toEqual([]);
    expect(result.parked).toHaveLength(1);
  });

  it("a park declared by an informational message freezes the thread and calls nobody", () => {
    // `expects: none` says in the author's own words that the message asks for nothing. This
    // is the PARK AS A MODE — a line of state calling nobody, which the door refused from 034
    // and passes again since 2026-08-04 (decision of john, thread 023). 016 and 052 are it.
    const result = withPark([{ ...PARKED, asks: false }]);

    expect(result.freshParked).toEqual([]);
    expect(result.lines).toEqual([]);
    expect(result.parked).toHaveLength(1);
  });

  it("an informational re-park does not ring either — a new stamp is not a new question", () => {
    // The shape of 016 exactly: the park is re-declared day after day by messages that ask
    // nothing, and every one of them used to be a fresh event because the key moved.
    const first = withPark([PARKED]);
    const later = withPark(
      [{ ...PARKED, since: "2026-08-03T08:29:57Z", question: "фиксация мыслей", asks: false }],
      { waiting: [], stalled: [], parked: first.parked },
    );

    expect(later.freshParked).toEqual([]);
    expect(later.lines).toEqual([]);
    // Nor is it a repeat line (thread 030, Д-2): `asks` is the message's own word, and a park
    // re-declared as a mode asks nobody anything — day after day, which is 016 exactly.
    expect(later.restatedParked).toEqual([]);
  });

  it("the SAME question asked again does not ring a second time — the key is (person, thread)", () => {
    // THE DEFECT Д-2, MEASURED IN THE FIELD 2026-08-21/22 (thread 030): a park is lifted by
    // anybody's later move, so a role raised on the thread finds its question unanswered and
    // writes it out again — and the stamp in the key made every such repeat a fresh call.
    // Two calls about aco-028 and two about LLE-102 in one day, one question each.
    const first = withPark([PARKED]);
    const later = withPark([{ ...PARKED, since: "2026-07-31T15:00:00Z", question: "И ещё?" }], {
      waiting: [],
      stalled: [],
      parked: first.parked,
    });

    expect(later.freshParked).toEqual([]);
    // NOT SILENCE, THOUGH — a downgrade (see the next test): the repeat is a line, and the
    // line goes in a letter somebody else's fresh event is already sending.
    expect(later.restatedParked).toHaveLength(1);
    expect(later.lines.map((line) => line.text)).toEqual([
      "still standing, asked again (not a new question): ❓ 023-x ждёт твоего решения: И ещё?",
    ]);
  });

  it("a repeat rides in a letter, it does not raise one — the send reads the fresh counts", () => {
    // The trigger and the composition of the letter are two different things (thread 030): the
    // `notify --write` door sends on `fresh`/`freshParked`/`freshStalled`/… and never on the
    // message being non-empty, so a plan whose only line is a repeat delivers nothing.
    const first = withPark([PARKED]);
    const later = withPark([{ ...PARKED, since: "2026-07-31T15:00:00Z", question: "И ещё?" }], {
      waiting: [],
      stalled: [],
      parked: first.parked,
    });

    expect(later.fresh).toEqual([]);
    expect(later.freshStalled).toEqual([]);
    expect(later.freshParked).toEqual([]);
    // AND THE STATE OF A TICK THAT SAID NOTHING KEEPS THE STAMP THAT WAS ANNOUNCED: the
    // courier ticks every few minutes, so a quiet tick recording the repeat as told would
    // turn the downgrade into a disappearance — the very swap this thread exists to undo.
    // Only the STAMP is rolled back — the question is not stored in the state file at all,
    // it is re-read from the message every tick, and this list is only ever written out.
    expect(later.parkedIfSilent).toEqual([{ ...PARKED, question: "И ещё?" }]);
    expect(later.parked).toEqual([
      { ...PARKED, since: "2026-07-31T15:00:00Z", question: "И ещё?" },
    ]);
  });

  it("a park LIFTED and asked again later rings — the memory is the composition, not a journal", () => {
    // The price the stamp used to buy, and the measurement that says it was not being bought
    // here: a lifted park falls out of the composition, so it falls out of the state file on
    // the next tick, and the next park of that pair is fresh again.
    const first = withPark([PARKED]);
    const lifted = withPark([], { waiting: [], stalled: [], parked: first.parked });

    expect(lifted.parked).toEqual([]);

    const again = withPark([{ ...PARKED, since: "2026-08-01T09:00:00Z", question: "Новый?" }], {
      waiting: [],
      stalled: [],
      parked: lifted.parked,
    });

    expect(again.freshParked).toHaveLength(1);
    expect(again.lines[0]?.text).toBe("❓ 023-x ждёт твоего решения: Новый?");
  });

  it("the one gap, named: a lift and a new park inside ONE tick window are a line, not a call", () => {
    // THE HONEST COST OF THE PAIR KEY, asserted rather than left to be discovered: if the
    // person answers and a NEW question is parked before the courier has ticked once, the
    // composition was never empty and the new question is read as a repeat. It is a race in
    // a single tick window, and what it loses is the ring — never the question.
    const first = withPark([PARKED]);
    const straightAway = withPark(
      [{ ...PARKED, since: "2026-07-31T15:00:00Z", question: "Совсем другое?" }],
      { waiting: [], stalled: [], parked: first.parked },
    );

    expect(straightAway.freshParked).toEqual([]);
    expect(straightAway.restatedParked).toHaveLength(1);
  });

  it("a parked thread is NOT also reported as stalled — the two say opposite things", () => {
    const result = withPark([PARKED], EMPTY, {
      stalled: [{ thread: "023-x", role: "curator", since: "2026-07-31T11:08:20Z", age: "5h" }],
    });

    expect(result.stalled).toEqual([]);
    expect(result.lines).toHaveLength(1);
  });

  it("and it is not also a 'poke the curator' line — the turn is frozen behind the reader", () => {
    const result = planNotifications({
      targets: TARGETS,
      waiting: [{ role: "curator", thread: "023-x" }],
      seen: EMPTY,
      parked: [PARKED],
      templates: PARK_TEMPLATE,
    });

    expect(result.lines.map((line) => line.kind)).toEqual(["parked"]);
    // The wait itself stays in the composition: the state remembers who holds the turn.
    expect(result.waiting).toEqual([{ role: "curator", thread: "023-x" }]);
  });

  it("a park on somebody the notifier does not write to is not a call", () => {
    const result = withPark([{ ...PARKED, person: "curator" }]);

    expect(result.parked).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it("BUT IT IS NOT INVISIBLE EITHER — the courier counts what it cannot call (thread 031)", () => {
    // THE OLD BEHAVIOUR, frozen here as the thing that must not come back: the target filter
    // ran BEFORE the counters, so this exact input — a live question standing on a person the
    // notifier has no way to reach — gave `parked`, `askingParked` and `freshParked` all empty
    // and no line, which is byte for byte what an EMPTY MAIL gives. One sentence for two
    // worlds, and the second world is the one thread 030 was spent on. Latent in this
    // repository (`wake.mode: 'self'` is john's alone) and not latent in a config that differs.
    const result = withPark([{ ...PARKED, person: "curator" }]);

    expect(result.unaddressedParked).toEqual([{ ...PARKED, person: "curator" }]);
    // And still not a call in any of its tenses: the three numbers describe the ring, and
    // ringing somebody ELSE about a question addressed to a person is a norm, not a repair.
    expect(result.askingParked).toEqual([]);
    expect(result.freshParked).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it("a person missing from the targets ALTOGETHER is counted the same way", () => {
    // The other way in, and the likelier one in the field: not `nudge` but absent — a role
    // switched off in the config, or one this instance does not raise. "Cannot be called" is
    // the fact the count is about, and `undefined` says it exactly as loudly as `nudge` does.
    const result = withPark([{ ...PARKED, person: "somebody-else", asks: false }]);

    expect(result.unaddressedParked).toHaveLength(1);
    // Informational parks are in it too: `asks` sorts the CALL, and there is no call here to
    // sort — what this count answers is "did the notifier drop a freeze on the floor".
    expect(result.parked).toEqual([]);
  });

  it("a park the notifier CAN call about stays out of that count", () => {
    const result = withPark([PARKED]);

    expect(result.unaddressedParked).toEqual([]);
    expect(result.freshParked).toEqual([PARKED]);
  });

  it("the state file carries parks beside waits and stalls", () => {
    // Neither the question nor `asks` is stored: the state answers one question — "was this
    // event announced" — and answers it by the key (person, thread, the stamp of the message).
    const state = { waiting: [], stalled: [], parked: [{ ...PARKED, question: "", asks: false }] };

    expect(parseNotifyState(renderNotifyState(state))).toEqual(state);
  });
});

describe("a park ANNOUNCED AND LIFTED — a line, never a call (thread 030, (в2))", () => {
  // THE DEFECT, in the shape it was measured in on 2026-08-22: a park on john was lifted by the
  // first message that moved anybody — an automatic `github` announcement nobody wrote — and the
  // thread left the courier's composition ENTIRELY. Not the call: all three numbers. Since (в1)
  // of the same day the person park lifts on `delivers: <that person>` alone, so what reaches
  // this plan is a key that was announced and no longer stands; the line about it is unchanged
  // in mechanism and says one thing less — see the wording below.
  const PARKED: ParkedThread = {
    thread: "030-x",
    person: "john",
    since: "2026-08-22T17:44:22Z",
    question: "Сузить ли снятие парковки до слова самого человека?",
    asks: true,
  };
  const PARK_TEMPLATE = { ...TEMPLATES, parked: "❓ {thread} ждёт твоего решения: {question}" };
  const ANNOUNCED: NotifyState = { waiting: [], stalled: [], parked: [PARKED] };

  const afterLift = (rest: Record<string, unknown> = {}) =>
    planNotifications({
      targets: TARGETS,
      waiting: [],
      seen: ANNOUNCED,
      parked: [],
      declaredParks: [PARKED],
      templates: PARK_TEMPLATE,
      ...rest,
    });

  it("names the thread, the person and the question — and does not read as a fresh call", () => {
    const result = afterLift();

    expect(result.liftedParked).toEqual([PARKED]);
    // THE SENTENCE CLAIMS ONLY WHAT IT MEASURED ((в1), 2026-08-22): it used to say "with no
    // answer named", which was true of the wide lift and is false of the narrow one — a person
    // park now goes on `delivers`, the field that NAMES the answer. The mechanism is untouched.
    expect(renderNotification(result.lines)).toBe(
      "the park was lifted, the last line about the question: " +
        "❓ 030-x ждёт твоего решения: Сузить ли снятие парковки до слова самого человека?",
    );
    // It is NOT in the composition and NOT a call: the three numbers say "nothing is parked",
    // which is true, and the line says what became of the question, which is the repair.
    expect(result.parked).toEqual([]);
    expect(result.askingParked).toEqual([]);
    expect(result.freshParked).toEqual([]);
  });

  it("holds the key through a quiet tick and drops it once a letter has carried the line", () => {
    // REQUIREMENT 3 OF THE STATEMENT, and the lesson of 051 taken the other way round: the
    // courier ticks every few minutes, so a state written from the composition alone would
    // forget the key on the first silent tick and the line would be owed to nobody.
    const owed = afterLift();

    expect(owed.parkedIfSilent).toEqual([PARKED]);

    // The letter goes out (the caller writes `parked`, which no longer holds the key), and the
    // tick after it is silent about a question already named.
    const told = planNotifications({
      targets: TARGETS,
      waiting: [],
      seen: { waiting: [], stalled: [], parked: owed.parked },
      parked: [],
      declaredParks: [PARKED],
      templates: PARK_TEMPLATE,
    });

    expect(told.liftedParked).toEqual([]);
    expect(told.lines).toEqual([]);
    expect(told.parkedIfSilent).toEqual([]);
  });

  it("a CLOSED thread gives no line and does not linger in the state — closing is the acceptance", () => {
    // `personParksOf` returns nothing for a closed thread, so the key finds no declaration:
    // no line, and — the half that matters as much — the key is not held pending for ever.
    const result = afterLift({ declaredParks: [] });

    expect(result.liftedParked).toEqual([]);
    expect(result.lines).toEqual([]);
    expect(result.parkedIfSilent).toEqual([]);
  });

  it("a park STILL STANDING is not a lift — and is not confused with a restatement either", () => {
    const result = planNotifications({
      targets: TARGETS,
      waiting: [],
      seen: ANNOUNCED,
      parked: [PARKED],
      declaredParks: [PARKED],
      templates: PARK_TEMPLATE,
    });

    expect(result.liftedParked).toEqual([]);
    expect(result.restatedParked).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it("a lifted INFORMATIONAL park owes nobody a line — `asks` is the message's own word", () => {
    // The park as a MODE (016, 052): it declared nothing to answer, so its lift answers
    // nothing. A ❓-class line over it is the lie by mark that thread 051 paid for.
    const mode: ParkedThread = { ...PARKED, asks: false };
    const result = planNotifications({
      targets: TARGETS,
      waiting: [],
      seen: { waiting: [], stalled: [], parked: [mode] },
      parked: [],
      declaredParks: [mode],
      templates: PARK_TEMPLATE,
    });

    expect(result.liftedParked).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it("a lift of a park on somebody the notifier does not write to is not a line", () => {
    const elsewhere: ParkedThread = { ...PARKED, person: "curator" };
    const result = planNotifications({
      targets: TARGETS,
      waiting: [],
      seen: { waiting: [], stalled: [], parked: [elsewhere] },
      parked: [],
      declaredParks: [elsewhere],
      templates: PARK_TEMPLATE,
    });

    expect(result.liftedParked).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it("the line rides in a letter somebody else's event triggered, and never raises one", () => {
    // The whole of "a line, never a call" (john's word: it lives as a LINE of the digest).
    // What the send condition reads is the `fresh*` counts, and none of them moves here.
    const result = afterLift({ waiting: [{ role: "john", thread: "016-y" }] });

    expect(result.fresh).toEqual([{ role: "john", thread: "016-y" }]);
    expect(result.lines.map((line) => line.kind)).toEqual(["parked", "turn"]);
  });
});

describe("a live park REMINDED about — the ninth class of event (thread 043, Д-4)", () => {
  // The measured picture: ten parks on john in `.orchestrator/notify.state` on 2026-08-29, the
  // oldest eleven days old, and not one of them mentioned since the tick it was declared on.
  const PARK: ParkedThread = {
    thread: "002-courier-mute",
    person: "john",
    since: "2026-08-18T09:00:00Z",
    question: "Гасим ли курьера на время починки?",
    asks: true,
  };
  const PARK_TEMPLATE = { ...TEMPLATES, parked: "❓ {thread} ждёт твоего решения: {question}" };
  const announced = (
    parks: readonly ParkedThread[],
    reminded?: readonly ParkReminder[],
  ): NotifyState => ({
    waiting: [],
    stalled: [],
    parked: parks.map((park) => ({ ...park, question: "", asks: false })),
    ...(reminded === undefined ? {} : { reminded }),
  });
  const at = (
    now: string,
    parked: readonly ParkedThread[] = [PARK],
    seen: NotifyState = announced([PARK]),
    rest = {},
  ) =>
    planNotifications({
      targets: TARGETS,
      waiting: [],
      seen,
      parked,
      now: new Date(now),
      templates: PARK_TEMPLATE,
      ...rest,
    });

  it("(а) a park younger than the threshold is silent — the reader is simply reading it", () => {
    const result = at("2026-08-18T11:59:00Z");

    expect(result.remindedParked).toEqual([]);
    expect(result.lines).toEqual([]);
    // And the clock is untouched: nothing was said, so nothing is recorded as said.
    expect(result.reminded).toEqual([]);
  });

  it("(б) past the threshold it is ONE line, and the line names the age", () => {
    const result = at("2026-08-29T09:00:00Z");

    expect(result.remindedParked).toHaveLength(1);
    expect(result.remindedParked[0]?.age).toBe("11d");
    // One line, not a header and a line: the header is for a queue, and this is one question.
    expect(result.lines.map((line) => line.text)).toEqual([
      "still on you after 11d — ❓ 002-courier-mute ждёт твоего решения: Гасим ли курьера на время починки?",
    ]);
    // The question is said in the words it was asked in and NOT repeated beyond the one line
    // the project's slot renders — point 2 of the statement.
    expect(result.reminded).toEqual([
      { person: "john", thread: "002-courier-mute", at: "2026-08-29T09:00:00.000Z" },
    ]);
  });

  it("(в) the next tick after a reminder is silent, and the tick past the interval is not", () => {
    const first = at("2026-08-29T09:00:00Z");
    const soon = at("2026-08-29T09:00:30Z", [PARK], announced([PARK], first.reminded));

    expect(soon.remindedParked).toEqual([]);
    expect(soon.lines).toEqual([]);
    // THE CLOCK SURVIVES THE QUIET TICK. Dropping it here would make the next tick a reminder
    // again, which is the every-thirty-seconds buzz this class exists to not become.
    expect(soon.reminded).toEqual(first.reminded);

    const later = at("2026-08-29T21:00:00Z", [PARK], announced([PARK], first.reminded));
    expect(later.remindedParked).toHaveLength(1);
    expect(later.reminded).toEqual([
      { person: "john", thread: "002-courier-mute", at: "2026-08-29T21:00:00.000Z" },
    ]);
  });

  it("(г) an answer stops the reminders in the same tick, and takes the clock with it", () => {
    // A `delivers: john` lifts the person park (R27), so the park leaves the composition the
    // caller hands over — and with it the entry that would otherwise silence the NEXT question
    // of the same pair for twelve hours.
    const first = at("2026-08-29T09:00:00Z");
    const answered = at("2026-08-29T21:00:00Z", [], announced([PARK], first.reminded));

    expect(answered.remindedParked).toEqual([]);
    expect(answered.lines.map((line) => line.kind)).not.toContain("parked");
    expect(answered.reminded).toEqual([]);
  });

  it("(г2) a closed thread is the same — the caller stops declaring the park, the clock clears", () => {
    // Closing IS the acceptance (thread 016): a closed thread contributes no park and no
    // declaration, so the class cannot speak about it even by accident.
    const first = at("2026-08-29T09:00:00Z");
    const closed = at("2026-08-30T09:00:00Z", [], announced([PARK], first.reminded), {
      declaredParks: [],
    });

    expect(closed.remindedParked).toEqual([]);
    expect(closed.reminded).toEqual([]);
  });

  it("(д) the dedup of Д-2 is untouched: a park announced once still rings only once", () => {
    // The regression this repair could plausibly cause: reminders are a SEPARATE class, so a
    // second tick inside the first three hours must still be the silence #63 bought.
    const first = at("2026-08-18T09:00:10Z", [PARK], EMPTY);
    const second = at("2026-08-18T09:00:40Z", [PARK], announced([PARK]));

    expect(first.freshParked).toHaveLength(1);
    expect(second.freshParked).toEqual([]);
    expect(second.remindedParked).toEqual([]);
    expect(second.lines).toEqual([]);
  });

  it("(д2) a park that has NEVER been announced is a call, not a reminder, however old", () => {
    // Otherwise the first tick of a box would say "still on you after 11d" about a question
    // nobody has been told about once — a reminder is by construction the second telling.
    const result = at("2026-08-29T09:00:00Z", [PARK], EMPTY);

    expect(result.freshParked).toHaveLength(1);
    expect(result.remindedParked).toEqual([]);
    // AND THE FRESH CALL SETS THE CLOCK GOING: without a stamp the very next tick past the
    // threshold would remind about a question that has just rung.
    expect(result.reminded).toEqual([]);
  });

  it("(д3) the eighth class keeps its own words beside a reminder — one fact each", () => {
    // Д-5 (thread 042): a park declared on ANOTHER role's turn leaves the pair unraised rather
    // than parked, and that pair has its own line. The reminder speaks to the person about the
    // question; the stale-park alarm speaks to the operator about the box. Two facts, two lines,
    // and neither may swallow the other.
    const inherited: ParkedThread = { ...PARK, thread: "042-x", holder: "curator" };
    const result = at("2026-08-29T09:00:00Z", [inherited], announced([inherited]), {
      unaccepted: [
        { role: "dev-core", thread: "042-x", since: "2026-08-29T08:00:00Z", age: "1h" },
      ] satisfies readonly UnacceptedTurn[],
    });

    expect(result.remindedParked).toHaveLength(1);
    expect(result.freshUnaccepted).toHaveLength(1);
    expect(result.lines.map((line) => line.kind)).toEqual(["unaccepted-stale-park", "parked"]);
  });

  it("a restatement and a reminder are never two lines about one question", () => {
    // Д-2's downgrade already puts a line about this key in this letter; a reminder beside it
    // is the two-lines-about-one-id noise thread 023 removed.
    const restated = at(
      "2026-08-29T09:00:00Z",
      [{ ...PARK, since: "2026-08-29T02:00:00Z", question: "Ну так гасим?" }],
      announced([PARK]),
    );

    expect(restated.restatedParked).toHaveLength(1);
    expect(restated.remindedParked).toEqual([]);
  });

  it("a park that asks nothing is never reminded — `asks` is the message's own word", () => {
    // 016 exactly: a park held as a MODE, re-declared day after day, asking nobody anything.
    // A reminder about it would be a call whose only honest text is "do nothing".
    const result = at("2026-08-29T09:00:00Z", [{ ...PARK, asks: false }], announced([PARK]));

    expect(result.remindedParked).toEqual([]);
    expect(result.reminded).toEqual([]);
  });

  it("a park on somebody the notifier cannot call is not reminded either", () => {
    // Thread 031: whom to ring instead of the named person is a decision about the norm, and
    // no reminder may take it. Such a park is never written as announced, so it never reminds.
    const result = at("2026-08-29T09:00:00Z", [{ ...PARK, person: "curator" }], {
      waiting: [],
      stalled: [],
      parked: [{ ...PARK, person: "curator", question: "", asks: false }],
    });

    expect(result.remindedParked).toEqual([]);
    expect(result.unaddressedParked).toHaveLength(1);
  });

  it("a queue of decisions opens with its size and the age of the oldest — the digest form", () => {
    // Point 5 of the statement: what a person with ten standing decisions needs FIRST is the
    // size of the queue, which no per-park line can say. One letter, one header, N lines.
    const second: ParkedThread = {
      thread: "037-no-foreground-waiting",
      person: "john",
      since: "2026-08-28T09:00:00Z",
      question: "Правило шире моего PR?",
      asks: true,
    };
    const result = at("2026-08-29T09:00:00Z", [PARK, second], announced([PARK, second]));

    expect(result.remindedParked).toHaveLength(2);
    expect(result.lines.map((line) => line.text)).toEqual([
      "2 decisions are standing on you, the oldest for 11d — these threads move when you answer:",
      "still on you after 11d — ❓ 002-courier-mute ждёт твоего решения: Гасим ли курьера на время починки?",
      "still on you after 1d — ❓ 037-no-foreground-waiting ждёт твоего решения: Правило шире моего PR?",
    ]);
  });

  it("no clock, no reminders — a caller that cannot say `now` writes no stamps", () => {
    const result = planNotifications({
      targets: TARGETS,
      waiting: [],
      seen: announced([PARK]),
      parked: [PARK],
      templates: PARK_TEMPLATE,
    });

    expect(result.remindedParked).toEqual([]);
    expect(result.lines).toEqual([]);
    expect(result.reminded).toEqual([]);
  });

  it("the clock survives a round trip through the state file, beside the parks", () => {
    const state: NotifyState = {
      waiting: [],
      stalled: [],
      parked: [{ ...PARK, question: "", asks: false }],
      reminded: [{ person: "john", thread: "002-courier-mute", at: "2026-08-29T09:00:00.000Z" }],
    };

    expect(parseNotifyState(renderNotifyState(state))).toEqual(state);
    // AND A FILE WRITTEN BEFORE THIS CLASS EXISTED READS AS "nobody has been reminded" rather
    // than as an unparsable line — which is what makes the ten standing parks ring on the first
    // tick after this ships.
    expect(
      parseNotifyState("parked\tjohn\t002-courier-mute\t2026-08-18T09:00:00Z\n").reminded,
    ).toBe(undefined);
  });
});

describe("a thread frozen behind an EVENT — the class that gets no line at all (thread 023)", () => {
  it("a merge the thread waits for is neither a call to john nor a stall", () => {
    // The one instruction the courier owes such a thread is silence: the decision behind it
    // has been made, and "nothing is moving this" would be false the moment the merge lands.
    const result = planNotifications({
      targets: TARGETS,
      waiting: [],
      seen: EMPTY,
      stalled: [{ thread: "023-x", role: "dev-core", since: "2026-07-31T09:00:00Z", age: "5 h" }],
      frozen: [{ thread: "023-x", pr: 366, kind: "event", since: "2026-07-31T09:00:00Z" }],
      templates: TEMPLATES,
    });

    expect(result.stalled).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it("a thread NOT frozen still stalls — the silence is about the park, not about the pass", () => {
    const result = planNotifications({
      targets: TARGETS,
      waiting: [],
      seen: EMPTY,
      stalled: [{ thread: "025-y", role: "dev-core", since: "2026-07-31T09:00:00Z", age: "5 h" }],
      frozen: [{ thread: "023-x", pr: 366, kind: "event", since: "2026-07-31T09:00:00Z" }],
      templates: TEMPLATES,
    });

    expect(result.stalled.map((turn) => turn.thread)).toEqual(["025-y"]);
  });
});

/**
 * THE WATCHDOG OVER THAT SAME SILENCE (thread 061, form (C)).
 *
 * The class above is right for every park the circuit is working through and blind to the one
 * it is not: the merge that landed with no `merged-pr` header (thread 030 — 8 hours, woken by
 * hand), and the park whose event needs a move by somebody the park itself keeps unraised
 * (thread 061 — the deadlock). Both look, to every other pass in this file, like a circuit
 * behaving as intended, and the cost of that is silence rather than a wrong verdict.
 */
describe("an event park past the band — the watchdog of thread 061", () => {
  const NOW = new Date("2026-08-31T12:00:00Z");
  const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

  const watch = (input: {
    readonly frozen: readonly EventPark[];
    readonly seen?: NotifyState;
    readonly targets?: NotificationTarget[];
  }) =>
    planNotifications({
      targets: input.targets ?? TARGETS,
      waiting: [],
      seen: input.seen ?? EMPTY,
      frozen: input.frozen,
      now: NOW,
      templates: TEMPLATES,
    });

  it("a park INSIDE the band is silent — the old promise of the class is kept", () => {
    const result = watch({
      frozen: [{ thread: "061-x", pr: 175, kind: "event", since: hoursAgo(5) }],
    });

    expect(result.staleEventParks).toEqual([]);
    expect(result.lines).toEqual([]);
    // And nothing is remembered about a park that was never announced: the tick it crosses
    // the band it must still be able to ring.
    expect(result.eventParkKeys).toEqual([]);
  });

  it("a park PAST the band rings once, naming the thread, the age and the PR", () => {
    const result = watch({
      frozen: [{ thread: "061-x", pr: 175, kind: "event", since: hoursAgo(9) }],
    });

    expect(result.staleEventParks.map((park) => park.thread)).toEqual(["061-x"]);
    const line = result.lines.find((entry) => entry.kind === "stale-event-park");
    expect(line?.thread).toBe("061-x");
    expect(line?.text).toContain("061-x has stood 9h");
    expect(line?.text).toContain("behind the merge of #175");
    // THE LIFT IS NAMED, and it is the half of the line that sends the reader to the right
    // place: a merge park lifts on a header nobody may remember to write.
    expect(line?.text).toContain("merged-pr: 175");
    expect(announcedOf(result)).toContain("061-x (stale park on #175)");
  });

  it("the SECOND tick is silent about the same park, and keeps its key", () => {
    const first = watch({
      frozen: [{ thread: "061-x", pr: 175, kind: "event", since: hoursAgo(9) }],
    });
    const second = watch({
      frozen: [{ thread: "061-x", pr: 175, kind: "event", since: hoursAgo(9) }],
      seen: { ...EMPTY, eventParks: first.eventParkKeys },
    });

    expect(second.staleEventParks).toEqual([]);
    expect(second.lines).toEqual([]);
    expect(second.eventParkKeys).toEqual(first.eventParkKeys);
  });

  it("a LIFTED park forgets itself, so the NEXT park of the same thread rings again", () => {
    const first = watch({
      frozen: [{ thread: "061-x", pr: 175, kind: "event", since: hoursAgo(9) }],
    });
    // The park is lifted: the caller stops handing it over, and the key must not survive —
    // a key kept past the lift would silence the next promise of the same thread.
    const lifted = watch({ frozen: [], seen: { ...EMPTY, eventParks: first.eventParkKeys } });
    expect(lifted.eventParkKeys).toEqual([]);

    const again = watch({
      frozen: [{ thread: "061-x", pr: 180, kind: "run", since: hoursAgo(7) }],
      seen: { ...EMPTY, eventParks: lifted.eventParkKeys },
    });
    expect(again.staleEventParks.map((park) => park.pr)).toEqual([180]);
  });

  it("a park on a ROUND names the round and not the header — the two lifts are different", () => {
    const result = watch({
      frozen: [{ thread: "062-y", pr: 160, kind: "run", since: hoursAgo(8) }],
    });

    const line = result.lines.find((entry) => entry.kind === "stale-event-park");
    expect(line?.text).toContain("behind the round of #160");
    expect(line?.text).toContain("the round of #160 reporting into that thread");
    expect(line?.text).not.toContain("merged-pr");
  });

  it("the threshold is the exported one, and the minute below it is silent", () => {
    const below = watch({
      frozen: [
        {
          thread: "061-x",
          pr: 175,
          kind: "event",
          since: new Date(
            NOW.getTime() - (EVENT_PARK_STALE_AFTER_MINUTES - 1) * 60_000,
          ).toISOString(),
        },
      ],
    });
    const at = watch({
      frozen: [
        {
          thread: "061-x",
          pr: 175,
          kind: "event",
          since: new Date(NOW.getTime() - EVENT_PARK_STALE_AFTER_MINUTES * 60_000).toISOString(),
        },
      ],
    });

    expect(below.staleEventParks).toEqual([]);
    expect(at.staleEventParks.map((park) => park.thread)).toEqual(["061-x"]);
  });

  it("with NO CLOCK there is no watchdog — silence, not an invented age", () => {
    const result = planNotifications({
      targets: TARGETS,
      waiting: [],
      seen: EMPTY,
      frozen: [{ thread: "061-x", pr: 175, kind: "event", since: hoursAgo(30) }],
      templates: TEMPLATES,
    });

    expect(result.staleEventParks).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it("with NOBODY TO SPEAK TO the line is not rendered — its move belongs to a person", () => {
    const result = watch({
      frozen: [{ thread: "061-x", pr: 175, kind: "event", since: hoursAgo(30) }],
      targets: [{ id: "curator", style: "nudge", nudge: "john" }],
    });

    expect(result.staleEventParks).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it("the key survives a round trip through the state file, and a malformed line is dropped", () => {
    const rendered = renderNotifyState({
      waiting: [],
      stalled: [],
      parked: [],
      eventParks: ["061-x\t175\t2026-08-30T09:00:00Z"],
    });
    expect(rendered).toContain("event-park\t061-x\t175\t2026-08-30T09:00:00Z");
    expect(parseNotifyState(rendered).eventParks).toEqual(["061-x\t175\t2026-08-30T09:00:00Z"]);
    // A line whose PR is not a number is dropped rather than half-read: a key that is not the
    // key would announce the same standstill a second time.
    expect(
      parseNotifyState("event-park\t061-x\trun-33344946364\t2026-08-30T09:00:00Z").eventParks,
    ).toBeUndefined();
    // And a state file written before this class existed reads as "never announced one",
    // which must not read as "everything is new" anywhere else in the file.
    expect(parseNotifyState("john\t016-x\n").eventParks).toBeUndefined();
  });
});

/**
 * THE SIXTH CLASS — A PAIR THE CIRCUIT HAS STOPPED RAISING (thread 013).
 *
 * The measured defect: on 2026-08-18 three pairs stood at the attempt ceiling for five
 * hours and the courier's line said `nothing to announce`. The repair is two events, and
 * every test below is about the one thing that makes them two rather than four: an
 * external freeze LEAVES the frozen set at each thaw, so the memory of "already
 * announced" has to be keyed by the SERIES and carried across the gap.
 */
describe("frozen pairs — one call per series, and a second one for the terminal", () => {
  const SINCE = "2026-08-18T18:00:00Z";
  const PAIR = { role: "dev-core", thread: "006-x", since: SINCE, attempts: 3 };

  const withFreezes = (exhausted: readonly ExhaustedPair[], seen: NotifyState = EMPTY) =>
    planNotifications({ targets: TARGETS, waiting: [], seen, exhausted, templates: TEMPLATES });

  /** The state the next run reads: what this one announced, carried in the state file. */
  const carried = (plan: { readonly freezeKeys: readonly string[] }): NotifyState => ({
    ...EMPTY,
    freezes: plan.freezeKeys,
  });

  it("a full backoff rings EXACTLY TWICE, in the order exhausted → frozen", () => {
    // The pair walks its whole schedule: 15 → 60 → 240 → spent. Between the rounds it is
    // thawed and running, which is where the free path loses the key (curator's trap).
    const rounds: ExhaustedPair[][] = [
      [{ ...PAIR, failureClass: "external", thaw: "2026-08-18T18:15:00Z" }],
      [PAIR], // thawed: the series lives, no freeze is in force
      [{ ...PAIR, failureClass: "external", thaw: "2026-08-18T19:15:00Z", attempts: 4 }],
      [PAIR],
      [{ ...PAIR, failureClass: "external", thaw: "2026-08-18T23:15:00Z", attempts: 5 }],
      [PAIR],
      [{ ...PAIR, failureClass: "external", thaw: null, attempts: 6 }],
      [{ ...PAIR, failureClass: "external", thaw: null, attempts: 6 }],
    ];
    let seen = EMPTY;
    const rung: string[] = [];
    for (const round of rounds) {
      const plan = withFreezes(round, seen);
      rung.push(...plan.freshFreezes.map((event) => event.kind));
      seen = carried(plan);
    }

    expect(rung).toEqual(["exhausted", "frozen"]);
  });

  it("the substantive class rings ONCE, as frozen — it is terminal from its first second", () => {
    const substantive = [{ ...PAIR, failureClass: "substantive" as const, thaw: null }];
    const first = withFreezes(substantive);
    const again = withFreezes(substantive, carried(first));

    expect(first.freshFreezes.map((event) => event.kind)).toEqual(["frozen"]);
    expect(again.freshFreezes).toEqual([]);
    // The call is terminal, so the text it carries must name a move that EXISTS: no message
    // into the thread lifts this pair (curator's §1, thread 013) — a run let through by hand
    // does, and the line the phone shows is the one place that fact reaches its reader.
    const said = renderNotification(first.lines);
    expect(said).toContain("--max-attempts");
    expect(said).not.toContain("only a delivery lifts it");
    expect(said).toContain("no message into that thread lifts it");
  });

  it("a delivery ends the series, and the NEXT freeze of the same pair rings again", () => {
    const first = withFreezes([
      { ...PAIR, failureClass: "external", thaw: "2026-08-18T18:15:00Z" },
    ]);
    // The delivery reset the counter: the caller stops passing the pair at all, so the key
    // is dropped — and the pair that freezes tomorrow is a new series, with a new stamp.
    const delivered = withFreezes([], carried(first));
    const later = withFreezes(
      [
        {
          ...PAIR,
          since: "2026-08-19T09:00:00Z",
          failureClass: "external",
          thaw: "2026-08-19T09:15:00Z",
        },
      ],
      carried(delivered),
    );

    expect(delivered.freezeKeys).toEqual([]);
    expect(later.freshFreezes.map((event) => event.kind)).toEqual(["exhausted"]);
  });

  it("the standing composition counts every pair AT the ceiling, announced or not", () => {
    // Rounds 2 and 3 do not ring; this is where they stay visible to whoever looks.
    const plan = withFreezes(
      [{ ...PAIR, failureClass: "external", thaw: "2026-08-18T19:15:00Z", attempts: 4 }],
      carried(withFreezes([{ ...PAIR, failureClass: "external", thaw: "2026-08-18T18:15:00Z" }])),
    );

    expect(plan.freshFreezes).toEqual([]);
    expect(plan.exhausted).toHaveLength(1);
  });

  it("a pair in the gap is in no line at all — there is no freeze in force", () => {
    const plan = withFreezes([PAIR]);

    expect(plan.freshFreezes).toEqual([]);
    expect(plan.exhausted).toEqual([]);
    expect(plan.lines).toEqual([]);
  });

  it("the announced keys survive a round trip through the state file", () => {
    const plan = withFreezes([{ ...PAIR, failureClass: "external", thaw: "2026-08-18T18:15:00Z" }]);
    const reread = parseNotifyState(renderNotifyState(carried(plan)));

    expect(reread.freezes).toEqual(plan.freezeKeys);
    expect(withFreezes([PAIR], reread).freezeKeys).toEqual(plan.freezeKeys);
  });

  it("nobody human configured — nothing rings, exactly as for the box's own alarms", () => {
    const plan = planNotifications({
      targets: [{ id: "curator", style: "nudge", nudge: "john" }],
      waiting: [],
      seen: EMPTY,
      exhausted: [{ ...PAIR, failureClass: "external", thaw: "2026-08-18T18:15:00Z" }],
    });

    expect(plan.freshFreezes).toEqual([]);
  });
});

/**
 * THE SET THE SIXTH CATEGORY COUNTS OVER (thread 016, defect 1).
 *
 * The control is the whole of it: a fix that simply stopped counting anything would pass
 * "the closed pair is gone" and fail "the open one is still there". The two cases below are
 * THE SAME PAIR — same role, same series, same fold — read against two mails.
 */
describe("exhaustedPairsOf — the closures the journal does not carry", () => {
  const frozen = (thread: string): LeaseView => ({
    role: "curator",
    thread,
    state: "released",
    attempt: 3,
    ceiling: 3,
    deadline: null,
    waitDeadline: null,
    reason: "exited-without-handoff",
    lastEvent: "lease-released",
    overdue: false,
    exhausted: true,
    launchable: false,
    exhaustedClass: "substantive",
    thawAt: null,
    exhaustedSince: "2026-08-19T09:00:00Z",
  });

  it("a pair whose thread is closed is not in it — and the same pair on an open thread is", () => {
    const views = [frozen("001-mail-born")];

    expect(exhaustedPairsOf({ views, closed: new Set(["001-mail-born"]) })).toEqual([]);
    expect(exhaustedPairsOf({ views, closed: new Set() }).map((pair) => pair.thread)).toEqual([
      "001-mail-born",
    ]);
  });

  it("only the closed thread's pair goes; the neighbours keep their series and their class", () => {
    const pairs = exhaustedPairsOf({
      views: [frozen("001-mail-born"), frozen("013-exhausted-visibility")],
      closed: new Set(["001-mail-born"]),
    });

    expect(pairs).toEqual([
      {
        role: "curator",
        thread: "013-exhausted-visibility",
        since: "2026-08-19T09:00:00Z",
        attempts: 3,
        failureClass: "substantive",
        thaw: null,
      },
    ]);
  });

  // The SERIES, not the freeze in force (thread 013): a pair mid-backoff is thawed for part
  // of every round and must stay in the composition, or the memory of "already announced"
  // falls out. Closing its thread is what takes it out — nothing else does.
  it("a thawed pair stays in the set, with no freeze in force to describe", () => {
    const thawed = { ...frozen("013-exhausted-visibility"), exhausted: false };

    expect(exhaustedPairsOf({ views: [thawed], closed: new Set() })).toEqual([
      {
        role: "curator",
        thread: "013-exhausted-visibility",
        since: "2026-08-19T09:00:00Z",
        attempts: 3,
      },
    ]);
  });
});

describe("a turn the box never took — the eighth class of event (thread 042)", () => {
  // The four windows of 2026-08-28/29 were dug out of two daemon logs by hand; these are the
  // same facts as fixtures, so nobody has to watch a live circuit for a night again.
  const untaken = (input: {
    readonly unaccepted?: readonly UnacceptedTurn[];
    readonly parked?: readonly ParkedThread[];
    readonly frozen?: readonly EventPark[];
    readonly stalled?: readonly StalledTurn[];
    readonly waiting?: readonly WaitingPair[];
    readonly seen?: NotifyState;
  }) =>
    planNotifications({
      targets: TARGETS,
      waiting: input.waiting ?? [],
      stalled: input.stalled ?? [],
      parked: input.parked ?? [],
      frozen: input.frozen ?? [],
      unaccepted: input.unaccepted ?? [],
      seen: input.seen ?? EMPTY,
      templates: TEMPLATES,
    });

  it("(а) a pair standing with no reason gets ONE line, with its age and its role", () => {
    const result = untaken({
      unaccepted: [
        { role: "curator", thread: "042-unaccepted", since: "2026-08-29T01:00:00Z", age: "19m" },
      ],
    });

    expect(result.unaccepted).toHaveLength(1);
    expect(result.unexplained).toHaveLength(1);
    const lines = result.lines.filter((line) => line.kind === "unaccepted");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toContain("curator×042-unaccepted");
    expect(lines[0]?.text).toContain("19m");
  });

  it("(а2) a turn NOTIFIED to its role is not thereby taken — the mail is not the box", () => {
    // The exact shape of the field silence: `⏳ твой ход` goes out every tick and no session is
    // ever raised. A class silenced by its own turn-notification could never fire at all.
    const result = untaken({
      waiting: [{ role: "curator", thread: "042-unaccepted" }],
      unaccepted: [
        { role: "curator", thread: "042-unaccepted", since: "2026-08-29T01:00:00Z", age: "19m" },
      ],
    });

    expect(result.unexplained).toHaveLength(1);
    expect(result.lines.some((line) => line.kind === "unaccepted")).toBe(true);
  });

  it("(а3) a reason the box KNOWS is printed and does not ring", () => {
    const result = untaken({
      unaccepted: [
        {
          role: "curator",
          thread: "042-unaccepted",
          since: "2026-08-29T01:00:00Z",
          age: "19m",
          reason: "launches are disabled on this box",
        },
      ],
    });

    expect(result.unaccepted).toHaveLength(1);
    expect(result.unexplained).toEqual([]);
    expect(result.freshUnaccepted).toEqual([]);
    expect(result.lines.some((line) => line.kind === "unaccepted")).toBe(false);
  });

  it("(б) a role busy on ANOTHER thread is a legitimate queue — nothing reaches the plan", () => {
    // The selector is where that judgement lives (`unacceptedTurns`); the plan is handed the
    // survivors, and the pair below never becomes one.
    const turns = unacceptedTurns({
      turns: [
        { role: "curator", thread: "042-unaccepted", since: "2026-08-29T01:00:00Z" },
        { role: "dev-core", thread: "026-codex", since: "2026-08-29T01:00:00Z" },
      ],
      raisedAt: new Map(),
      busyRoles: new Set(["curator"]),
      now: new Date("2026-08-29T02:00:00Z"),
    });

    expect(turns.map((turn) => turn.role)).toEqual(["dev-core"]);
  });

  /**
   * THE FIRST FIELD FIRING OF THIS CLASS, AND IT WAS FALSE — the six journal records of
   * 2026-08-29 (`.orchestrator/journal.jsonl` of this box) and the line they produced
   * (`.orchestrator/daemon.log:30783`):
   *
   * ```
   * 02:37:45Z lease-acquired curator × 026-codex-agent-kind
   * 02:38:57Z the letter that handed the turn to curator — the stamp the age counts from
   * 02:39:31Z handoff-detected dev-core × 042-unaccepted-turn-silent
   * 02:52:31Z lease-released curator × 026-codex-agent-kind            ← the role frees up
   * 02:52:53Z the daemon self-restarts onto the merged code
   * 02:53:11Z first tick of the new process: `1 unaccepted over 10m, 1 the box cannot justify,
   *           1 of those new — curator×042-unaccepted-turn-silent (14m, no reason known)`
   * 02:53:17Z lease-acquired curator × 042-unaccepted-turn-silent      ← six seconds later
   * ```
   *
   * The `since` is the MAIL's stamp and not the journal's: the class counts from `waitingSince`,
   * the first letter of the run that left the turn where it stands (here the reviewer's verdict
   * at 02:38:57Z), which is what makes the field line say `14m` and not `13m`.
   *
   * Thirteen of those fourteen minutes were `curator` queueing behind its OWN other thread —
   * check (б) of the statement, the circuit working — and the pair rang one tick before its own
   * raise. Both fixtures below are built from these stamps and nothing else.
   */
  const FIELD = {
    turn: { role: "curator", thread: "042-unaccepted-turn-silent", since: "2026-08-29T02:38:57Z" },
    busy: [{ role: "curator", from: "2026-08-29T02:37:45Z", to: "2026-08-29T02:52:31Z" }],
  } as const;

  it("(б2) the queue counts for nothing AFTER it ends — the false call of 2026-08-29T02:53:11Z", () => {
    const turns = unacceptedTurns({
      turns: [FIELD.turn],
      raisedAt: new Map([["curator\t026-codex-agent-kind", "2026-08-29T02:37:45Z"]]),
      // The role is free at the instant of the tick — that is exactly why the pair reached the
      // class at all, and why asking only `busyRoles` was not enough.
      busyRoles: new Set(),
      busy: FIELD.busy,
      now: new Date("2026-08-29T02:53:11Z"),
    });

    expect(turns).toEqual([]);
  });

  it("(б3) and the queue does not blind the class — free past the threshold, it speaks", () => {
    // The same six records, twelve minutes later with nobody raising the pair. Subtracting the
    // queue must not turn the eighth class off; what it removes is the queue, not the standstill.
    const turns = unacceptedTurns({
      turns: [FIELD.turn],
      raisedAt: new Map(),
      busyRoles: new Set(),
      busy: FIELD.busy,
      now: new Date("2026-08-29T03:05:00Z"),
    });

    expect(turns).toHaveLength(1);
    // AND THE AGE IS THE FREE PART OF IT — 12 m of the 26 (changed 2026-08-29, with the park
    // of (е) below: the age and the threshold say the same thing now, and `26m` about a box
    // that had the pair raisable for twelve minutes is the number the reader acts on).
    expect(turns[0]?.age).toBe("12m");
    expect(turns[0]?.reason).toBeUndefined();
  });

  /**
   * THE THIRD FALSE FIRING OF THE CLASS, and the same породу as (б2) with another interval —
   * the line of `.orchestrator/daemon.log:19561` of this box, ~10:05Z on 2026-08-29:
   *
   * ```
   * 03:27:44Z `03-27-44Z-curator.md` — `parked-on: john`, `waiting-on: curator`: the park,
   *           and the stamp the age counts from (`waiting since` of 703 queue lines)
   * …         742 ticks of `candidate curator×042… skipped: the turn is parked behind a
   *           decision of john` — the box saying, every 30 seconds, exactly why it was silent
   * 10:05:00Z the lift: `delivers: john`
   * 10:05:0xZ the first tick after it: `1 unaccepted over 10m, 1 the box cannot justify,
   *           1 of those new — curator×042-unaccepted-turn-silent (6h 37m, no reason known)`
   * 10:05:39Z lease-acquired curator × 042-unaccepted-turn-silent      ← 39 seconds later
   * ```
   *
   * Six hours and thirty-seven minutes of a legitimate freeze — one §5 of the statement excludes
   * from this class by name — were counted into the age of a standstill that was 39 seconds old,
   * and john was rung about a box that had been printing its reason 742 times. The park is
   * invisible to the reasons map the moment it is lifted, so nothing said the word "park" in the
   * call; the fix is the interval, not a second reason.
   */
  const PARKED = {
    turn: { role: "curator", thread: "042-unaccepted-turn-silent", since: "2026-08-29T03:27:44Z" },
    parks: [
      {
        thread: "042-unaccepted-turn-silent",
        from: "2026-08-29T03:27:44Z",
        to: "2026-08-29T10:05:00Z",
      },
    ],
  } as const;

  it("(е) the park counts for nothing AFTER it is lifted — the false call of 2026-08-29T10:05Z", () => {
    const turns = unacceptedTurns({
      turns: [PARKED.turn],
      raisedAt: new Map(),
      // The pair is free at the instant of the tick — the park was lifted seconds ago, which is
      // exactly why it reached the class at all, and why `parkingOf` has nothing left to say.
      busyRoles: new Set(),
      parks: PARKED.parks,
      now: new Date("2026-08-29T10:05:05Z"),
    });

    expect(turns).toEqual([]);
  });

  it("(е2) and the park does not blind the class — free past the threshold, it speaks", () => {
    // The same records, a quarter of an hour later with nobody raising the pair. Curing the
    // false call by silence would be the worse of the two defects (the statement of #102), so
    // what is subtracted is the freeze — and what is left is the standstill, named with the
    // length of its own free part.
    const turns = unacceptedTurns({
      turns: [PARKED.turn],
      raisedAt: new Map(),
      busyRoles: new Set(),
      parks: PARKED.parks,
      now: new Date("2026-08-29T10:20:00Z"),
    });

    expect(turns).toHaveLength(1);
    expect(turns[0]?.age).toBe("15m");
    expect(turns[0]?.reason).toBeUndefined();
  });

  it("(е3) a pair that stood WITHOUT a park rings as it rang — the subtraction eats no class", () => {
    const turns = unacceptedTurns({
      turns: [PARKED.turn],
      raisedAt: new Map(),
      busyRoles: new Set(),
      parks: [
        // A park of ANOTHER thread is none of this pair's business, and neither is one that
        // ended before the turn was handed over.
        {
          thread: "026-codex-agent-kind",
          from: "2026-08-29T03:27:44Z",
          to: "2026-08-29T10:05:00Z",
        },
        {
          thread: "042-unaccepted-turn-silent",
          from: "2026-08-29T01:00:00Z",
          to: "2026-08-29T03:00:00Z",
        },
      ],
      now: new Date("2026-08-29T10:20:00Z"),
    });

    expect(turns).toHaveLength(1);
    expect(turns[0]?.age).toBe("6h 52m");
  });

  it("(е5) THE FIELD WINDOW OF `curator×051`, 2026-08-30 — an event park is a freeze like any other", () => {
    // The candidate curator measured over the threshold by hand (12.9 free minutes of a 30.4
    // minute stand) and asked to be re-judged by the class's own arithmetic. The numbers are the
    // live journal of this box and the live feed of `051-index-shows-parks`:
    //
    //  - the turn passed to `curator` at 09:29:02Z (the stamp of the letter; the journal's
    //    `handoff-detected` is eight seconds later) and was raised at 09:59:35Z;
    //  - the letter carried `parked-on: run:126` — the daemon printed `⏸ PARKED behind the round
    //    running on PR #126 (R27)` on every tick of the stand — and the park lifted at 09:59:02Z;
    //  - `curator`'s own leases inside the window: `038` 09:32:39→09:36:31, `047`
    //    09:42:27→09:50:48, `036` 09:51:26→09:56:42 — 17.5 minutes of legitimate queue.
    //
    // The tick asked about is the one AFTER the lift and BEFORE the raise, the only one on which
    // this pair could have reached the class at all. Subtracting only the queue leaves 13.0 free
    // minutes and rings; subtracting the park too leaves nothing, which is the truth: the box was
    // never free to raise this pair for a single minute of those thirty.
    const turn = {
      role: "curator",
      thread: "051-index-shows-parks",
      since: "2026-08-30T09:29:02Z",
    } as const;
    const busy = [
      { role: "curator", from: "2026-08-30T09:32:39Z", to: "2026-08-30T09:36:31Z" },
      { role: "curator", from: "2026-08-30T09:42:27Z", to: "2026-08-30T09:50:48Z" },
      { role: "curator", from: "2026-08-30T09:51:26Z", to: "2026-08-30T09:56:42Z" },
    ] as const;
    const now = new Date("2026-08-30T09:59:32Z");

    // Reading the queue alone — what the courier did before the park became an interval — used
    // to leave 13.0 SUMMED free minutes and ring on this very tick. Since the free part became
    // the uninterrupted tail (the false call of 2026-08-30, §6.4) this reading is silent too: the
    // role's last lease ended at 09:56:42Z, two minutes and fifty seconds before the tick, and
    // that is the whole of the idleness this box can be accused of.
    const withoutThePark = unacceptedTurns({
      turns: [turn],
      raisedAt: new Map(),
      busyRoles: new Set(),
      busy,
      now,
    });
    expect(withoutThePark).toEqual([]);

    const withThePark = unacceptedTurns({
      turns: [turn],
      raisedAt: new Map(),
      busyRoles: new Set(),
      busy,
      parks: [
        {
          thread: "051-index-shows-parks",
          from: "2026-08-30T09:29:02Z",
          to: "2026-08-30T09:59:02Z",
        },
      ],
      now,
    });
    expect(withThePark).toEqual([]);
  });

  it("(е4) a queue INSIDE a park is subtracted once — the two sources are unioned, not summed", () => {
    // The role holds a lease on its other thread while this thread is frozen: the same hour is
    // in both lists, and summing them would hand the box an alibi for time it really was free.
    const turns = unacceptedTurns({
      turns: [PARKED.turn],
      raisedAt: new Map(),
      busyRoles: new Set(),
      parks: PARKED.parks,
      busy: [{ role: "curator", from: "2026-08-29T04:00:00Z", to: "2026-08-29T09:00:00Z" }],
      now: new Date("2026-08-29T10:20:00Z"),
    });

    // The lease lies INSIDE the park, so the merged block ends where the park lifted (10:05:00Z)
    // and the tail is the fifteen minutes since — the lease adds nothing to it and takes nothing
    // from it. Summing the two lists would subtract the five hours twice, take the free part
    // below zero and silence the class; overlapping the ends would move the lift back to 09:00
    // and add an hour of idleness the box never had.
    expect(turns).toHaveLength(1);
    expect(turns[0]?.age).toBe("15m");
  });

  it("(е6) THE THIRD FALSE CALL, 2026-08-30 — free slivers between sessions are not free time", () => {
    // The line john got: `curator×052-pr-template has been standing for 20m and this box has not
    // raised it: the role is free …`. His own check a minute later: the daemon up, no flags, and
    // `2 of 3 role(s) live` — `curator` running `053` since 13:25:33Z. The journal says how the
    // twenty minutes were collected: `curator` worked its queue one session at a time all
    // morning (`045`, `047`, `042`, `036`, `053` …) and the gaps between those sessions are 25
    // and 26 seconds. `052` was sixth in that queue on every tick of it — the daemon printed
    // `candidate curator×052-pr-template skipped: curator already has a session … this pair is
    // first in line for curator next tick` — so no sliver of that morning was time the box could
    // have raised the pair and didn't.
    //
    // The stamps are the live journal of 2026-08-30; `since` is the queue line's `waiting since`.
    const turn = { role: "curator", thread: "052-pr-template", since: "2026-08-30T10:59:57Z" };
    const busy = [
      { role: "curator", from: "2026-08-30T13:00:14Z", to: "2026-08-30T13:06:37Z" },
      { role: "curator", from: "2026-08-30T13:07:10Z", to: "2026-08-30T13:12:31Z" },
      { role: "curator", from: "2026-08-30T13:13:00Z", to: "2026-08-30T13:20:56Z" },
      { role: "curator", from: "2026-08-30T13:21:21Z", to: "2026-08-30T13:25:06Z" },
    ];

    // The tick inside a gap between two sessions — the only kind of moment on which this pair
    // ever reached the class, and the moment the line was composed on.
    expect(
      unacceptedTurns({
        turns: [turn],
        raisedAt: new Map(),
        busyRoles: new Set(),
        busy,
        now: new Date("2026-08-30T13:25:20Z"),
      }),
    ).toEqual([]);

    // And the same instant with the next session running — what john saw when he read the line.
    // Both readings agree now, which is the point: a sentence that is true for fourteen seconds
    // and false when it is read is the thing this rule removes.
    expect(
      unacceptedTurns({
        turns: [turn],
        raisedAt: new Map(),
        busyRoles: new Set(["curator"]),
        busy: [
          ...busy,
          { role: "curator", from: "2026-08-30T13:25:32Z", to: "2026-08-30T13:35:07Z" },
        ],
        now: new Date("2026-08-30T13:26:30Z"),
      }),
    ).toEqual([]);

    // THE CLASS IS NOT WEAKENED — the same pair on a box that then went quiet. Eleven minutes
    // after the last session ended, with nobody raising it, the standstill is real and the line
    // is true of every word it says: this is `051` standing 3 h 16 m, the call john kept.
    const quiet = unacceptedTurns({
      turns: [turn],
      raisedAt: new Map(),
      busyRoles: new Set(),
      busy,
      now: new Date("2026-08-30T13:36:30Z"),
    });
    expect(quiet).toHaveLength(1);
    expect(quiet[0]?.age).toBe("11m");
    expect(quiet[0]?.reason).toBeUndefined();
  });

  it("(в) a park DECLARED ON THIS PAIR'S TURN keeps its thread — no second line", () => {
    const result = untaken({
      parked: [
        {
          thread: "042-unaccepted",
          person: "john",
          since: "2026-08-29T01:00:00Z",
          question: "A or B?",
          asks: true,
          holder: "curator",
        },
      ],
      unaccepted: [
        { role: "curator", thread: "042-unaccepted", since: "2026-08-29T01:00:00Z", age: "19m" },
      ],
    });

    expect(result.unaccepted).toEqual([]);
    expect(result.lines.some((line) => line.kind.startsWith("unaccepted"))).toBe(false);
  });

  it("(в2) a park that OUTLIVED the turn it was declared on is the standstill, not a park", () => {
    // The measured window, from `daemon.log.1:15100` of the LLE box: `queue 3/4:
    // dev-speech×010-speech-service — priority normal, waiting since 2026-08-28T12:14:09Z ·
    // ⏸ PARKED behind a decision of john (R27)`. The park was declared by `12-11-29Z-curator.md`
    // on CURATOR's turn; the turn moved to dev-speech two letters later, and the pair stood
    // 4 h 16 m while the daemon printed a true sentence about the thread and a false one about
    // the pair. The discrimination is the HOLDER, not the presence of a park.
    const result = untaken({
      parked: [
        {
          thread: "010-speech-service",
          person: "john",
          since: "2026-08-28T12:11:29Z",
          question: "Какой вариант?",
          asks: true,
          holder: "curator",
        },
      ],
      unaccepted: [
        {
          role: "dev-speech",
          thread: "010-speech-service",
          since: "2026-08-28T12:14:09Z",
          age: "4h 16m",
        },
      ],
    });

    expect(result.unaccepted).toHaveLength(1);
    expect(result.unaccepted[0]?.staleParkOn).toBe("john");
    const lines = result.lines.filter((line) => line.kind === "unaccepted-stale-park");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toContain("dev-speech×010-speech-service");
    expect(lines[0]?.text).toContain("john");
    // And it does NOT send the reader to the daemon: the box is innocent here.
    expect(lines[0]?.text).not.toContain("are launches enabled");
  });

  it("(в3) a park with NO holder of its own keeps the whole thread — the pre-042 park", () => {
    const result = untaken({
      parked: [
        {
          thread: "010-speech-service",
          person: "john",
          since: "2026-08-28T12:11:29Z",
          question: "?",
          asks: true,
        },
      ],
      unaccepted: [
        {
          role: "dev-speech",
          thread: "010-speech-service",
          since: "2026-08-28T12:14:09Z",
          age: "4h 16m",
        },
      ],
    });

    expect(result.unaccepted).toEqual([]);
  });

  it("(в4) a FROZEN thread stays with its own class whoever holds the turn", () => {
    const result = untaken({
      frozen: [
        { thread: "019-round", pr: 19, kind: "run", since: "2026-08-29T01:00:00Z" } as const,
      ],
      unaccepted: [
        { role: "curator", thread: "019-round", since: "2026-08-29T01:00:00Z", age: "19m" },
      ],
    });

    expect(result.unaccepted).toEqual([]);
  });

  it("(г) the turn is taken the moment a lease POSTDATES the handoff", () => {
    const raised = unacceptedTurns({
      turns: [{ role: "curator", thread: "042-unaccepted", since: "2026-08-29T01:00:00Z" }],
      raisedAt: new Map([["curator\t042-unaccepted", "2026-08-29T01:00:23Z"]]),
      busyRoles: new Set(),
      now: new Date("2026-08-29T02:00:00Z"),
    });
    // A pair raised YESTERDAY and left standing on a handoff of this morning is untaken — a
    // rule that asked "was it ever raised" would call it healthy for good.
    const stale = unacceptedTurns({
      turns: [{ role: "curator", thread: "042-unaccepted", since: "2026-08-29T01:00:00Z" }],
      raisedAt: new Map([["curator\t042-unaccepted", "2026-08-28T01:00:23Z"]]),
      busyRoles: new Set(),
      now: new Date("2026-08-29T02:00:00Z"),
    });

    expect(raised).toEqual([]);
    expect(stale).toHaveLength(1);
    expect(stale[0]?.age).toBe("1h");
  });

  it("(г2) below the threshold nothing is said at all", () => {
    const turns = unacceptedTurns({
      turns: [{ role: "curator", thread: "042-unaccepted", since: "2026-08-29T01:55:00Z" }],
      raisedAt: new Map(),
      busyRoles: new Set(),
      now: new Date("2026-08-29T02:00:00Z"),
    });

    expect(turns).toEqual([]);
    expect(UNACCEPTED_AFTER_MINUTES).toBe(10);
  });

  it("(г3) it rings ONCE per handoff, and a new handoff is a new call", () => {
    const turn: UnacceptedTurn = {
      role: "curator",
      thread: "042-unaccepted",
      since: "2026-08-29T01:00:00Z",
      age: "19m",
    };
    const again = untaken({
      unaccepted: [turn],
      seen: { ...EMPTY, unaccepted: [{ ...turn, age: "" }] },
    });
    const moved = untaken({
      unaccepted: [{ ...turn, since: "2026-08-29T01:40:00Z" }],
      seen: { ...EMPTY, unaccepted: [{ ...turn, age: "" }] },
    });

    expect(again.freshUnaccepted).toEqual([]);
    expect(again.unaccepted).toHaveLength(1);
    expect(moved.freshUnaccepted).toHaveLength(1);
  });

  it("(д) the 180-minute stall stays silent about a pair this class already names", () => {
    const result = untaken({
      stalled: [
        { thread: "042-unaccepted", role: "curator", since: "2026-08-29T01:00:00Z", age: "3h 20m" },
      ],
      unaccepted: [
        { role: "curator", thread: "042-unaccepted", since: "2026-08-29T01:00:00Z", age: "3h 20m" },
      ],
    });

    expect(result.stalled).toEqual([]);
    expect(result.unaccepted).toHaveLength(1);
  });

  it("(д3) with nobody to call, the class takes NO line away — the stall keeps its own", () => {
    // A box whose only targets are nudged (no `direct`) rings nothing about the daemon, so the
    // precedence above would delete a line and put none in its place. Measured on the daemon's
    // own fixture of thread 024, where a pair standing 34 days went silent.
    const result = planNotifications({
      targets: [{ id: "curator", style: "nudge", nudge: "john" }],
      waiting: [],
      stalled: [
        { thread: "042-unaccepted", role: "curator", since: "2026-08-29T01:00:00Z", age: "3h 20m" },
      ],
      parked: [],
      unaccepted: [
        { role: "curator", thread: "042-unaccepted", since: "2026-08-29T01:00:00Z", age: "3h 20m" },
      ],
      seen: EMPTY,
      templates: TEMPLATES,
    });

    expect(result.freshUnaccepted).toEqual([]);
    expect(result.stalled).toHaveLength(1);
    expect(result.freshStalled).toHaveLength(1);
  });

  it("(д2) a stall the class does NOT name is untouched — Д-2 and Д-4 keep their lines", () => {
    const result = untaken({
      stalled: [
        { thread: "007-other", role: "dev-speech", since: "2026-08-29T01:00:00Z", age: "3h 20m" },
      ],
      unaccepted: [
        { role: "curator", thread: "042-unaccepted", since: "2026-08-29T01:00:00Z", age: "3h 20m" },
      ],
    });

    expect(result.stalled.map((turn) => turn.thread)).toEqual(["007-other"]);
    expect(result.freshStalled).toHaveLength(1);
  });

  it("the state file carries the pair and the handoff, and an old file reads as 'none announced'", () => {
    const state: NotifyState = {
      ...EMPTY,
      unaccepted: [
        { role: "curator", thread: "042-unaccepted", since: "2026-08-29T01:00:00Z", age: "19m" },
      ],
    };
    const round = parseNotifyState(renderNotifyState(state));

    // The age is NOT stored: it changes every tick and the identity does not.
    expect(round.unaccepted).toEqual([
      { role: "curator", thread: "042-unaccepted", since: "2026-08-29T01:00:00Z", age: "" },
    ]);
    expect(parseNotifyState("waiting\tjohn\t016-x\n").unaccepted).toBeUndefined();
  });
});

/**
 * THE NINTH CLASS — THE BOX IS NOT RUNNING WHAT WAS MERGED (thread 044).
 *
 * The measured case: a repair merged at 03:24:02Z, twenty-seven lease-free windows in the
 * same day, and the circuit still on the old code in the morning — with the daemon saying
 * so in `daemon.log` every thirty seconds and nobody reading it. What the courier adds is
 * not a new measurement (the daemon's is the only one) but a READER.
 */
describe("a box behind its own ref — the ninth class of event (thread 044)", () => {
  const DRIFT = {
    sha: "a830761a",
    refSha: "951b7551",
    ref: "origin/main",
    size: "3 commit(s) behind, drifting for 6h (since 2026-08-29T03:24:02Z)",
    why: "no self-restart while sessions are live (curator) — a graceful restart would wait for them, and that wait needs a human",
    since: "2026-08-29T03:24:02Z",
  };

  const planDrift = (seen: NotifyState = EMPTY, drift = DRIFT) =>
    planNotifications({
      targets: TARGETS,
      waiting: [],
      seen,
      templates: TEMPLATES,
      drift,
    });

  it("rings with the size, the two SHAs and the daemon's own reason", () => {
    const result = planDrift();
    expect(result.freshDrift).toBe(true);
    const line = result.lines.find((entry) => entry.kind === "code-drift");
    expect(line).toBeDefined();
    expect(line?.text).toContain("a830761a");
    expect(line?.text).toContain("951b7551");
    expect(line?.text).toContain("3 commit(s) behind, drifting for 6h");
    expect(line?.text).toContain("sessions are live");
  });

  // The line reports and does not order: what to do about a window that will not open is a
  // judgement about live work, and the statement of the thread is explicit that a forced
  // rollout is not invented without john.
  it("names no command — the person decides what to do about a live session", () => {
    const line = planDrift().lines.find((entry) => entry.kind === "code-drift");
    // The daemon's reason is carried VERBATIM and may well contain the word "restart" —
    // what the courier may not add is an instruction of its own.
    expect(line?.text.replace(DRIFT.why, "")).not.toContain("--pull");
    expect(line?.text.replace(DRIFT.why, "")).not.toContain("systemctl");
    expect(line?.text.replace(DRIFT.why, "")).not.toContain("restart");
  });

  it("rings ONCE per period of being behind: the same stamp is silent from the second run", () => {
    const result = planDrift({ ...EMPTY, drift: DRIFT.since });
    expect(result.freshDrift).toBe(false);
    expect(result.lines.some((entry) => entry.kind === "code-drift")).toBe(false);
    // …and the composition survives, so the state keeps saying what stands.
    expect(result.drift?.since).toBe(DRIFT.since);
  });

  it("a NEW period rings again — a box that caught up and fell behind is a new event", () => {
    const result = planDrift({ ...EMPTY, drift: "2026-08-28T01:00:00Z" });
    expect(result.freshDrift).toBe(true);
  });

  it("is dropped when nobody human is configured — a chat assistant cannot act on a box", () => {
    const result = planNotifications({
      targets: [{ id: "curator", style: "nudge", nudge: "john" }],
      waiting: [],
      seen: EMPTY,
      templates: TEMPLATES,
      drift: DRIFT,
    });
    expect(result.freshDrift).toBe(false);
    expect(result.lines.some((entry) => entry.kind === "code-drift")).toBe(false);
  });

  it("the state file carries the stamp, and an old file still parses", () => {
    const rendered = renderNotifyState({ ...EMPTY, drift: DRIFT.since });
    expect(rendered).toContain(`drift\t${DRIFT.since}`);
    expect(parseNotifyState(rendered).drift).toBe(DRIFT.since);
    expect(parseNotifyState("john\t044-x\n").drift).toBeUndefined();
  });
});

// THE TENTH CLASS — WHAT THE TICK SAYS ABOUT ACCOUNTS (thread 036, the tail of §4). The three
// sentences are the planner's own (`describeFailover`, `describeAccountPause`,
// `describeRefusals`, landed in #105) and are handed over rendered; what is decided here is
// only which of them RING, and the whole subject is that two of them are STATES and one is an
// EVENT. The texts below are copied from the live describers rather than imported, so that a
// re-wording of them is a failing test and not a silent change of what john reads.
describe("the accounts of the box — the tenth class of event (thread 036)", () => {
  const HELD = {
    kind: "held" as const,
    role: "dev-core",
    // NO TAB IN THE FACT — the state file is columns, and this fixture is the contract of
    // `AccountAlarm.about` being kept rather than described: a caller that joined two facts
    // with `\t` would have its key cut in half by the next parse of the file.
    about: "lle-main until 2026-08-30T14:00:00Z",
    text: "account-failover: launches of dev-core are held until 14:00Z — every account of its chain is quota-paused (the first to reopen is lle-main, five_hour window)",
  };
  const SWITCH = {
    kind: "failover" as const,
    role: "curator",
    about: "2026-08-30T11:02:00Z",
    text: "account-failover: curator is raised on lle-second — lle-main is quota-paused until 14:00Z (five_hour window, seen at 2026-08-30T09:00:00Z)",
  };
  const CHAIN = {
    kind: "chain" as const,
    role: "dev-core",
    about: "ghost-acct",
    text: "account-failover: the fall-back 'ghost-acct' of dev-core is NOT spent — this machine declares no such account",
  };

  const planAccounts = (accounts: readonly AccountAlarm[], seen: NotifyState = EMPTY) =>
    planNotifications({ targets: TARGETS, waiting: [], seen, templates: TEMPLATES, accounts });

  const accountLines = (plan: NotificationPlan) =>
    plan.lines.filter((entry) => entry.kind === "account");

  // (а) The half that pays TODAY, with every chain empty: a role standing behind its own
  // closed window says so, with the clock on it, instead of standing in silence.
  it("a held role rings exactly once, with the time the window reopens", () => {
    const lines = accountLines(planAccounts([HELD]));
    expect(lines).toHaveLength(1);
    // The sentence is carried verbatim — the courier does not re-word the planner.
    expect(lines[0]?.text).toBe(HELD.text);
    expect(lines[0]?.text).toContain("held until 14:00Z");
    expect(lines[0]?.role).toBe("dev-core");
  });

  // (б) O2 — the state is said ONCE. The tick runs every thirty seconds and a quota window
  // stands for hours: a line repeated N times is the noise that teaches its reader to skip.
  it("the same held state on the next tick is silent — the key is what was announced", () => {
    const seen: NotifyState = { ...EMPTY, accounts: [accountAlarmKey(HELD)] };
    expect(accountLines(planAccounts([HELD], seen))).toHaveLength(0);
    // …and the composition survives the silence, so the state keeps saying what stands.
    expect(planAccounts([HELD], seen).accountKeys).toEqual([accountAlarmKey(HELD)]);
  });

  it("a NEW window of the same role rings again — the shelf is part of the identity", () => {
    const seen: NotifyState = { ...EMPTY, accounts: [accountAlarmKey(HELD)] };
    const next = { ...HELD, about: "lle-main until 2026-08-30T19:00:00Z" };
    expect(accountLines(planAccounts([next], seen))).toHaveLength(1);
  });

  // (в) O3 — the event is NEVER weighed against the memory of the states. A failover moves
  // the spending of a run onto another subscription, and the owner of both learns it from
  // the system rather than from a bill (§4 of the statement, 2026-08-28).
  it("a failover rings even with its own key already in the state — an event, not a state", () => {
    const seen: NotifyState = {
      ...EMPTY,
      accounts: [accountAlarmKey(SWITCH), accountAlarmKey(HELD)],
    };
    const lines = accountLines(planAccounts([SWITCH], seen));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe(SWITCH.text);
    // And it leaves NO key behind: what is remembered is the standing states, so a switch
    // that happened is never mistaken for one that is still standing.
    expect(planAccounts([SWITCH], seen).accountKeys).toEqual([]);
  });

  it("a standing pause does not swallow the switch that rides with it", () => {
    const seen: NotifyState = { ...EMPTY, accounts: [accountAlarmKey(HELD)] };
    const lines = accountLines(planAccounts([HELD, SWITCH], seen));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe(SWITCH.text);
  });

  // A broken link of a chain is a defect of the config: it stands until somebody edits the
  // file, so it rings on the run that finds it and not on every tick after it.
  it("a refused fall-back rings once and is remembered by the link it names", () => {
    expect(accountLines(planAccounts([CHAIN]))).toHaveLength(1);
    expect(planAccounts([CHAIN]).accountKeys).toEqual([accountAlarmKey(CHAIN)]);
    const seen: NotifyState = { ...EMPTY, accounts: [accountAlarmKey(CHAIN)] };
    expect(accountLines(planAccounts([CHAIN], seen))).toHaveLength(0);
  });

  // The key is the kind, the role and the fact — in that order, and all three matter: one
  // role can stand behind a closed chain AND carry a broken link, with two repairs.
  it("the key tells the two facts of one role apart", () => {
    expect(accountAlarmKey(HELD)).not.toBe(accountAlarmKey(CHAIN));
    expect(accountLines(planAccounts([HELD, CHAIN]))).toHaveLength(2);
  });

  // (г) THE QUIET TICK — every role on its own account, no shelf anywhere. The digest must
  // be byte-for-byte what it was before this class existed.
  it("a quiet tick says nothing at all, and an absent field is the same as an empty one", () => {
    const quiet = planNotifications({
      targets: TARGETS,
      waiting: [{ role: "john", thread: "036-account-failover" }],
      seen: EMPTY,
      templates: TEMPLATES,
    });
    const empty = planNotifications({
      targets: TARGETS,
      waiting: [{ role: "john", thread: "036-account-failover" }],
      seen: EMPTY,
      templates: TEMPLATES,
      accounts: [],
    });
    expect(accountLines(quiet)).toHaveLength(0);
    expect(quiet.freshAccounts).toEqual([]);
    expect(quiet.accountKeys).toEqual([]);
    expect(renderNotification(empty.lines)).toBe(renderNotification(quiet.lines));
  });

  it("is dropped when nobody human is configured — a chat assistant pays no bill", () => {
    const result = planNotifications({
      targets: [{ id: "curator", style: "nudge", nudge: "john" }],
      waiting: [],
      seen: EMPTY,
      templates: TEMPLATES,
      accounts: [HELD, SWITCH],
    });
    expect(accountLines(result)).toHaveLength(0);
  });

  it("the state file carries the keys, and a file written before this class still parses", () => {
    const rendered = renderNotifyState({ ...EMPTY, accounts: [accountAlarmKey(CHAIN)] });
    expect(rendered).toContain(`account\tchain\tdev-core\tghost-acct`);
    expect(parseNotifyState(rendered).accounts).toEqual([accountAlarmKey(CHAIN)]);
    expect(parseNotifyState("john\t036-x\n").accounts).toBeUndefined();
    // A line that is not one of the three kinds is dropped, on the freeze rule: a key that
    // is not the key announces the same standstill a second time.
    expect(parseNotifyState("account\tnonsense\tdev-core\t\n").accounts).toBeUndefined();
  });

  // THE FACT WITH A SPACE IN IT SURVIVES THE FILE — the round-trip on the state that actually
  // carries a composed `about` (an account AND the window it reopens at), and the reason the
  // fixtures above carry no tab: the file is columns, so a tab inside the fact would come back
  // as a shorter key and the same closed window would ring a second time.
  it("a held state's key comes back from the file whole, spaces and all", () => {
    const rendered = renderNotifyState({ ...EMPTY, accounts: [accountAlarmKey(HELD)] });
    expect(parseNotifyState(rendered).accounts).toEqual([accountAlarmKey(HELD)]);
    expect(accountAlarmKey(HELD)).toContain("lle-main until 2026-08-30T14:00:00Z");
  });

  // (д) THE DAEMON'S OWN LOG — the stitch `planNotifications` → the courier's summary, which
  // the round of `reviewer-pr` on #146 found silent: the letter to john carried the account
  // line while the log printed an empty tail, and "nothing to report" is exactly how a reader
  // of the log understands it.
  it("the operator's log names the class that went out, and names its role and kind", () => {
    expect(announcedOf(planAccounts([HELD]))).toEqual(["dev-core (account: held)"]);
    expect(announcedOf(planAccounts([SWITCH]))).toEqual(["curator (account: failover)"]);
    // Two facts of one role are two entries — two repairs, and the log is where the operator
    // sees that the letter carried both.
    expect(announcedOf(planAccounts([HELD, CHAIN]))).toEqual([
      "dev-core (account: held)",
      "dev-core (account: chain)",
    ]);
  });

  it("a state already announced is not in the log either — it says what WENT OUT", () => {
    const seen: NotifyState = { ...EMPTY, accounts: [accountAlarmKey(HELD)] };
    expect(announcedOf(planAccounts([HELD], seen))).toEqual([]);
    expect(announcedOf(planAccounts([HELD, SWITCH], seen))).toEqual([
      "curator (account: failover)",
    ]);
  });

  it("the account stands in the log where its line stands in the letter — under the drift", () => {
    const plan = planNotifications({
      targets: TARGETS,
      waiting: [{ role: "john", thread: "036-account-failover" }],
      seen: EMPTY,
      templates: TEMPLATES,
      accounts: [SWITCH],
      drift: {
        sha: "a830761a",
        refSha: "951b7551",
        ref: "origin/main",
        size: "3 commit(s) behind",
        why: "no self-restart while sessions are live (curator)",
        since: "2026-08-29T03:24:02Z",
      },
    });
    expect(announcedOf(plan)).toEqual([
      "the box is behind its own ref (3 commit(s) behind)",
      "curator (account: failover)",
      "036-account-failover",
    ]);
  });
});
