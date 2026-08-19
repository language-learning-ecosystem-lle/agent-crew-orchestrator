/**
 * The notifier's core. Every test here is a property the bash predecessor had to
 * learn the hard way (threads 005, 008, 011) — they are carried over as tests
 * precisely because the reasons are not obvious from the code and would be
 * "simplified" away by whoever meets it next.
 */
import { describe, expect, it } from "vitest";

import type { NotificationTarget } from "../roles/registry.js";
import {
  describeAge,
  type ExhaustedPair,
  type NotifyState,
  type ParkedThread,
  parseNotifyState,
  planNotifications,
  renderAnnouncement,
  renderNotification,
  renderNotifyState,
  type StalledTurn,
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
  });

  it("a thread answered and parked AGAIN is a new question — the key is the parking message", () => {
    const first = withPark([PARKED]);
    const later = withPark([{ ...PARKED, since: "2026-07-31T15:00:00Z", question: "И ещё?" }], {
      waiting: [],
      stalled: [],
      parked: first.parked,
    });

    expect(later.freshParked).toHaveLength(1);
    expect(later.lines).toHaveLength(1);
    expect(later.lines[0]?.text).toBe("❓ 023-x ждёт твоего решения: И ещё?");
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

  it("the state file carries parks beside waits and stalls", () => {
    // Neither the question nor `asks` is stored: the state answers one question — "was this
    // event announced" — and answers it by the key (person, thread, the stamp of the message).
    const state = { waiting: [], stalled: [], parked: [{ ...PARKED, question: "", asks: false }] };

    expect(parseNotifyState(renderNotifyState(state))).toEqual(state);
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
    expect(renderNotification(first.lines)).toContain("only a delivery lifts it");
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
