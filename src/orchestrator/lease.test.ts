import { describe, expect, it } from "vitest";

import { MAX_ATTEMPTS, type OrchestratorEvent } from "./journal.js";
import { foldLeases, type LeaseView } from "./lease.js";

const NOW = new Date("2026-07-24T14:00:00Z");
const PAST = "2026-07-24T13:30:00Z"; // раньше NOW
const FUTURE = "2026-07-24T15:00:00Z"; // позже NOW

// Метки событий не важны для свёртки (порядок — по строкам журнала), но обязаны
// быть валидны по схеме; выдаём монотонные, чтобы читались.
let clock = 0;
const ts = (): string => {
  clock += 1;
  return `2026-07-24T12:${String(clock).padStart(2, "0")}:00Z`;
};

const acquire = (role: string, thread: string, deadline: string): OrchestratorEvent => ({
  kind: "lease-acquired",
  ts: ts(),
  role,
  thread,
  deadline,
});
const release = (
  role: string,
  thread: string,
  reason: "completed" | "forced" | "exited-without-handoff" | "timeout" | "exhausted",
): OrchestratorEvent => ({ kind: "lease-released", ts: ts(), role, thread, reason });
const handoff = (role: string, thread: string): OrchestratorEvent => ({
  kind: "handoff-detected",
  ts: ts(),
  role,
  thread,
});
const launch = (role: string, thread: string): OrchestratorEvent => ({
  kind: "launch",
  ts: ts(),
  role,
  thread,
});
const stop = (role: string, thread: string, mode: "graceful" | "forced"): OrchestratorEvent => ({
  kind: "stop",
  ts: ts(),
  role,
  thread,
  mode,
});

const only = (events: OrchestratorEvent[]): LeaseView => {
  const views = foldLeases(events, NOW);
  expect(views).toHaveLength(1);
  return views[0] as LeaseView;
};

describe("foldLeases — жизненный цикл", () => {
  it("взятие аренды → running, deadline и attempt проставлены", () => {
    const v = only([acquire("dev-core", "t", FUTURE)]);
    expect(v).toMatchObject({ state: "running", attempt: 1, deadline: FUTURE, reason: null });
  });

  it("handoff → draining", () => {
    expect(only([acquire("dev-core", "t", FUTURE), handoff("dev-core", "t")]).state).toBe(
      "draining",
    );
  });

  it("stop → stopped с режимом в reason", () => {
    const v = only([acquire("dev-core", "t", FUTURE), stop("dev-core", "t", "forced")]);
    expect(v).toMatchObject({ state: "stopped", reason: "forced" });
  });

  it("launch не меняет состояния аренды", () => {
    const v = only([acquire("dev-core", "t", FUTURE), launch("dev-core", "t")]);
    expect(v.state).toBe("running");
    expect(v.lastEvent).toBe("launch");
  });
});

describe("foldLeases — пробел 1: работает vs повис (overdue)", () => {
  it("аренда жива, deadline прошёл → overdue", () => {
    expect(only([acquire("dev-core", "t", PAST)]).overdue).toBe(true);
  });

  it("аренда жива, deadline впереди → не overdue", () => {
    expect(only([acquire("dev-core", "t", FUTURE)]).overdue).toBe(false);
  });

  it("overdue держится и в draining (ход ушёл, но сессия не закрыта)", () => {
    const v = only([acquire("dev-core", "t", PAST), handoff("dev-core", "t")]);
    expect(v).toMatchObject({ state: "draining", overdue: true });
  });

  it("снятая аренда с прошедшим deadline — уже НЕ overdue (не активна)", () => {
    const v = only([acquire("dev-core", "t", PAST), release("dev-core", "t", "timeout")]);
    expect(v.overdue).toBe(false);
  });
});

describe("foldLeases — пробел 2: потолок попыток (exhausted / launchable)", () => {
  it("неуспешный финал, попыток меньше потолка → launchable, не exhausted", () => {
    const v = only([acquire("dev-core", "t", PAST), release("dev-core", "t", "timeout")]);
    expect(v).toMatchObject({ attempt: 1, launchable: true, exhausted: false });
  });

  it("успешный финал (completed) → не launchable и не exhausted", () => {
    const v = only([acquire("dev-core", "t", FUTURE), release("dev-core", "t", "completed")]);
    expect(v).toMatchObject({ launchable: false, exhausted: false });
  });

  it("attempt растёт с каждым взятием; на потолке — exhausted, не launchable", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      events.push(acquire("dev-core", "t", PAST), release("dev-core", "t", "timeout"));
    }
    const v = only(events);
    expect(v.attempt).toBe(MAX_ATTEMPTS);
    expect(v).toMatchObject({ exhausted: true, launchable: false });
  });

  it("явное lease-released reason=exhausted → exhausted независимо от счётчика", () => {
    const v = only([acquire("dev-core", "t", PAST), release("dev-core", "t", "exhausted")]);
    expect(v).toMatchObject({ exhausted: true, launchable: false });
  });

  it("exited-without-handoff — такой же неуспех для потолка, как timeout и forced", () => {
    const v = only([
      acquire("dev-core", "t", PAST),
      release("dev-core", "t", "exited-without-handoff"),
    ]);
    expect(v).toMatchObject({ attempt: 1, launchable: true, exhausted: false });
  });

  it("самостоятельные выходы копятся до потолка и дальше связка не запускается", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      events.push(
        acquire("dev-core", "t", PAST),
        release("dev-core", "t", "exited-without-handoff"),
      );
    }
    expect(only(events)).toMatchObject({ exhausted: true, launchable: false });
  });
});

describe("foldLeases — несколько связок", () => {
  it("разные (role, thread) независимы и сохраняют порядок появления", () => {
    const views = foldLeases(
      [
        acquire("dev-core", "t1", FUTURE),
        acquire("dev-speech", "t2", PAST),
        release("dev-speech", "t2", "timeout"),
      ],
      NOW,
    );
    expect(views.map((v) => `${v.role}/${v.thread}`)).toEqual(["dev-core/t1", "dev-speech/t2"]);
    expect(views[0]).toMatchObject({ state: "running", overdue: false });
    expect(views[1]).toMatchObject({ state: "released", launchable: true });
  });

  it("одна и та же роль на разных тредах — разные связки", () => {
    const views = foldLeases(
      [acquire("dev-core", "t1", FUTURE), acquire("dev-core", "t2", FUTURE)],
      NOW,
    );
    expect(views).toHaveLength(2);
  });

  it("пустой журнал — пустая свёртка", () => {
    expect(foldLeases([], NOW)).toEqual([]);
  });
});

describe("foldLeases — launch-refused не создаёт аренду", () => {
  const refused = (role: string, thread: string): OrchestratorEvent => ({
    kind: "launch-refused",
    ts: ts(),
    role,
    thread,
    reason: "run-budget",
  });

  it("связка только с launch-refused — фантомной аренды нет", () => {
    expect(foldLeases([refused("dev-core", "t")], NOW)).toEqual([]);
  });

  it("launch-refused между реальными событиями связку не искажает", () => {
    const v = only([
      refused("dev-core", "t"),
      acquire("dev-core", "t", FUTURE),
      refused("dev-core", "t"),
    ]);
    expect(v).toMatchObject({ state: "running", attempt: 1, lastEvent: "lease-acquired" });
  });
});
