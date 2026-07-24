import { describe, expect, it } from "vitest";

import { observeStep, stepEvent } from "./observe.js";

const sig = (over: Partial<{ handedOff: boolean; processExited: boolean; overdue: boolean }>) => ({
  handedOff: false,
  processExited: false,
  overdue: false,
  ...over,
});

describe("observeStep — running", () => {
  it("ничего не произошло → наблюдаем дальше (null)", () => {
    expect(observeStep("running", sig({}))).toBeNull();
  });

  it("ход перешёл → handoff-detected (в draining), процесс не трогаем", () => {
    expect(observeStep("running", sig({ handedOff: true }))).toEqual({
      record: "handoff-detected",
    });
  });

  it("ход перешёл ПЕРЕВЕШИВАЕТ overdue: заметили на дедлайне — всё равно успех", () => {
    expect(observeStep("running", sig({ handedOff: true, overdue: true }))).toEqual({
      record: "handoff-detected",
    });
  });

  it("дедлайн без перехода хода → timeout (застрял, предел draining)", () => {
    expect(observeStep("running", sig({ overdue: true }))).toEqual({
      record: "lease-released",
      reason: "timeout",
    });
  });

  it("процесс вышел САМ без перехода хода до дедлайна → exited-without-handoff", () => {
    expect(observeStep("running", sig({ processExited: true }))).toEqual({
      record: "lease-released",
      reason: "exited-without-handoff",
    });
  });

  it("самостоятельный выход НЕ выдаётся за форс — иначе журнал врёт в сценарии 3", () => {
    const step = observeStep("running", sig({ processExited: true }));
    expect(step).not.toEqual({ record: "lease-released", reason: "forced" });
  });

  it("код 0 без перехода хода ≠ завершение: handedOff=false → НЕ completed", () => {
    const step = observeStep("running", sig({ processExited: true }));
    expect(step).not.toEqual({ record: "lease-released", reason: "completed" });
  });

  it("таймаут сильнее самостоятельного выхода: overdue проверяется раньше", () => {
    expect(observeStep("running", sig({ processExited: true, overdue: true }))).toEqual({
      record: "lease-released",
      reason: "timeout",
    });
  });
});

describe("observeStep — draining", () => {
  it("ход уже перешёл, процесс ещё жив → ждём (null)", () => {
    expect(observeStep("draining", sig({}))).toBeNull();
  });

  it("процесс вышел сам → completed (агент дописал и завершился без сигнала)", () => {
    expect(observeStep("draining", sig({ processExited: true }))).toEqual({
      record: "lease-released",
      reason: "completed",
    });
  });

  it("процесс залип за дедлайн → completed (дело сделано), CLI его гасит", () => {
    expect(observeStep("draining", sig({ overdue: true }))).toEqual({
      record: "lease-released",
      reason: "completed",
    });
  });
});

describe("stepEvent", () => {
  const base = { ts: "2026-07-24T14:00:00Z", role: "dev-core", thread: "012-x" };

  it("handoff-detected → событие того же вида", () => {
    expect(stepEvent({ record: "handoff-detected" }, base)).toEqual({
      kind: "handoff-detected",
      ...base,
    });
  });

  it("lease-released несёт reason", () => {
    expect(stepEvent({ record: "lease-released", reason: "completed" }, base)).toEqual({
      kind: "lease-released",
      ...base,
      reason: "completed",
    });
  });

  it("новая причина доезжает до события журнала как есть", () => {
    expect(stepEvent({ record: "lease-released", reason: "exited-without-handoff" }, base)).toEqual(
      {
        kind: "lease-released",
        ...base,
        reason: "exited-without-handoff",
      },
    );
  });
});
