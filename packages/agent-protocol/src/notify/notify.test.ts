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
  describeAge,
  type ExhaustedPair,
  exhaustedPairsOf,
  type NotifyState,
  type ParkedThread,
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

describe("a thread frozen behind an EVENT — the class that gets no line at all (thread 023)", () => {
  it("a merge the thread waits for is neither a call to john nor a stall", () => {
    // The one instruction the courier owes such a thread is silence: the decision behind it
    // has been made, and "nothing is moving this" would be false the moment the merge lands.
    const result = planNotifications({
      targets: TARGETS,
      waiting: [],
      seen: EMPTY,
      stalled: [{ thread: "023-x", role: "dev-core", since: "2026-07-31T09:00:00Z", age: "5 h" }],
      frozen: ["023-x"],
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
      frozen: ["023-x"],
      templates: TEMPLATES,
    });

    expect(result.stalled.map((turn) => turn.thread)).toEqual(["025-y"]);
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
    readonly frozen?: readonly string[];
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
   * 02:39:31Z handoff-detected dev-core × 042-unaccepted-turn-silent   ← the age counts from here
   * 02:52:31Z lease-released curator × 026-codex-agent-kind            ← the role frees up
   * 02:52:53Z the daemon self-restarts onto the merged code
   * 02:53:11Z first tick of the new process: `1 unaccepted over 10m, 1 the box cannot justify,
   *           1 of those new — curator×042-unaccepted-turn-silent (14m, no reason known)`
   * 02:53:17Z lease-acquired curator × 042-unaccepted-turn-silent      ← six seconds later
   * ```
   *
   * Thirteen of those fourteen minutes were `curator` queueing behind its OWN other thread —
   * check (б) of the statement, the circuit working — and the pair rang one tick before its own
   * raise. Both fixtures below are built from these stamps and nothing else.
   */
  const FIELD = {
    turn: { role: "curator", thread: "042-unaccepted-turn-silent", since: "2026-08-29T02:39:31Z" },
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
    // The AGE stays the whole standing time — the number the reader sees in the feed — while
    // what crossed the threshold is the free part of it (12 m of the 25).
    expect(turns[0]?.age).toBe("25m");
    expect(turns[0]?.reason).toBeUndefined();
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
      frozen: ["019-round"],
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
