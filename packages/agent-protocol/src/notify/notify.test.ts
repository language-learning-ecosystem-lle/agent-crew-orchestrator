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
  type NotifyState,
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

const EMPTY: NotifyState = { waiting: [], stalled: [] };

const plan = (waiting: readonly WaitingPair[], seen: readonly WaitingPair[] = []) =>
  planNotifications({
    targets: TARGETS,
    waiting,
    seen: { waiting: seen, stalled: [] },
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

    const state = { waiting: pairs, stalled: [] };

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
    const again = withStall([STALLED], { waiting: [], stalled: first.stalled });

    expect(again.freshStalled).toEqual([]);
    expect(again.lines).toHaveLength(1); // still SAID, only not counted as new
  });

  it("a fork that moves and stalls AGAIN is a new event — the key is the handoff", () => {
    const first = withStall([STALLED]);
    const later = withStall([{ ...STALLED, since: "2026-07-28T14:00:00Z", age: "3h" }], {
      waiting: [],
      stalled: first.stalled,
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
    const state = { waiting: [{ role: "john", thread: "b" }], stalled: [{ ...STALLED, age: "" }] };

    expect(parseNotifyState(renderNotifyState(state))).toEqual(state);
    expect(parseNotifyState("john\tb\n")).toEqual({
      waiting: [{ role: "john", thread: "b" }],
      stalled: [],
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
