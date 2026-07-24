import { describe, expect, it } from "vitest";
import type { OrchestratorEvent } from "./journal.js";
import { MAX_CONSECUTIVE_RUNS } from "./launch.js";
import { type Candidate, planTick } from "./tick.js";

const NOW = new Date("2026-07-24T14:00:00Z");
const cand: Candidate[] = [{ role: "dev-core", thread: "t1" }];

const acquire = (role: string, thread: string): OrchestratorEvent => ({
  kind: "lease-acquired",
  ts: "2026-07-24T13:00:00Z",
  role,
  thread,
  deadline: "2026-07-24T15:00:00Z",
});
const released = (
  role: string,
  thread: string,
  reason: "completed" | "timeout",
): OrchestratorEvent => ({
  kind: "lease-released",
  ts: "2026-07-24T13:30:00Z",
  role,
  thread,
  reason,
});
const launch = (role: string, thread: string): OrchestratorEvent => ({
  kind: "launch",
  ts: "2026-07-24T13:00:00Z",
  role,
  thread,
});

const base = { events: [] as OrchestratorEvent[], candidates: cand, now: NOW };

describe("planTick — тормоз и выключение (требования 2, 3)", () => {
  it("стоп-флаг → halt, даже при enabled и кандидатах", () => {
    expect(planTick({ ...base, enabled: true, stopped: true })).toEqual({ kind: "halt" });
  });

  it("не включён → disabled (стартовое состояние — выключено)", () => {
    expect(planTick({ ...base, enabled: false, stopped: false })).toEqual({ kind: "disabled" });
  });

  it("стоп перекрывает включение", () => {
    expect(planTick({ ...base, enabled: true, stopped: true }).kind).toBe("halt");
  });
});

describe("planTick — запуск", () => {
  it("включён, кандидат свеж → launch первого пригодного", () => {
    expect(planTick({ ...base, enabled: true, stopped: false })).toEqual({
      kind: "launch",
      role: "dev-core",
      thread: "t1",
    });
  });

  it("нет кандидатов → idle", () => {
    expect(planTick({ ...base, candidates: [], enabled: true, stopped: false })).toEqual({
      kind: "idle",
    });
  });

  it("связка уже running → пропущена (idle, если других нет)", () => {
    expect(
      planTick({
        ...base,
        events: [acquire("dev-core", "t1")],
        enabled: true,
        stopped: false,
      }),
    ).toEqual({ kind: "idle" });
  });

  it("связка exhausted → пропущена (потолок попыток на треде)", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < 3; i += 1) {
      events.push(acquire("dev-core", "t1"), released("dev-core", "t1", "timeout"));
    }
    expect(planTick({ ...base, events, enabled: true, stopped: false })).toEqual({ kind: "idle" });
  });

  it("выбирает ПЕРВУЮ пригодную, пропуская активную", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "busy" },
      { role: "dev-core", thread: "free" },
    ];
    const decision = planTick({
      ...base,
      candidates,
      events: [acquire("dev-core", "busy")],
      enabled: true,
      stopped: false,
    });
    expect(decision).toEqual({ kind: "launch", role: "dev-core", thread: "free" });
  });
});

describe("planTick — hold ручной сессии (S5)", () => {
  it("роль занята человеком → held с её именем, а не launch", () => {
    expect(planTick({ ...base, enabled: true, stopped: false, held: ["dev-core"] })).toEqual({
      kind: "held",
      roles: ["dev-core"],
    });
  });

  it("работы нет вовсе → idle, а не held: hold без почты контур не тревожит", () => {
    expect(
      planTick({ ...base, candidates: [], enabled: true, stopped: false, held: ["dev-core"] }),
    ).toEqual({ kind: "idle" });
  });

  it("hold держит РОЛЬ, а не связку — занята на всех своих тредах", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "t1" },
      { role: "dev-core", thread: "t2" },
    ];
    expect(
      planTick({ ...base, candidates, enabled: true, stopped: false, held: ["dev-core"] }),
    ).toEqual({ kind: "held", roles: ["dev-core"] });
  });

  it("занята одна роль — другие запускаются как обычно", () => {
    const candidates: Candidate[] = [
      { role: "dev-core", thread: "t1" },
      { role: "dev-speech", thread: "t2" },
    ];
    expect(
      planTick({ ...base, candidates, enabled: true, stopped: false, held: ["dev-core"] }),
    ).toEqual({ kind: "launch", role: "dev-speech", thread: "t2" });
  });

  it("стоп-флаг сильнее holdʼа — аварийный тормоз ни с чем не спорит", () => {
    expect(planTick({ ...base, enabled: true, stopped: true, held: ["dev-core"] }).kind).toBe(
      "halt",
    );
  });

  it("без holdʼов поведение прежнее", () => {
    expect(planTick({ ...base, enabled: true, stopped: false, held: [] }).kind).toBe("launch");
  });
});

describe("planTick — глобальный потолок со следом (требование 1)", () => {
  it("потолок исчерпан → refused run-budget (не launch)", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_CONSECUTIVE_RUNS; i += 1) events.push(launch("x", `t${i}`));
    expect(planTick({ ...base, events, enabled: true, stopped: false })).toEqual({
      kind: "refused",
      role: "dev-core",
      thread: "t1",
      reason: "run-budget",
    });
  });

  it("completed обнуляет счётчик → снова launch", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_CONSECUTIVE_RUNS; i += 1) events.push(launch("x", `t${i}`));
    events.push(released("x", "t0", "completed"));
    expect(planTick({ ...base, events, enabled: true, stopped: false }).kind).toBe("launch");
  });

  it("потолок калибруется", () => {
    const events = [launch("x", "1"), launch("x", "2")];
    expect(
      planTick({ ...base, events, enabled: true, stopped: false, maxConsecutive: 2 }).kind,
    ).toBe("refused");
    expect(
      planTick({ ...base, events, enabled: true, stopped: false, maxConsecutive: 5 }).kind,
    ).toBe("launch");
  });
});
