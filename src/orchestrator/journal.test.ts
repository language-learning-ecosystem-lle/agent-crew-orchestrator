import { describe, expect, it } from "vitest";

import {
  type OrchestratorEvent,
  parseEventLine,
  parseJournal,
  renderEventLine,
  renderJournal,
} from "./journal.js";

const acquired: OrchestratorEvent = {
  kind: "lease-acquired",
  ts: "2026-07-24T13:00:00Z",
  role: "dev-core",
  thread: "014-reviewer-verdict-delivery",
  deadline: "2026-07-24T13:30:00Z",
};

describe("renderEventLine / parseEventLine", () => {
  it("round-trip сохраняет событие", () => {
    expect(parseEventLine(renderEventLine(acquired))).toEqual(acquired);
  });

  it("кривая строка — громкий отказ, а не пропуск", () => {
    expect(() => parseEventLine("не json")).toThrow(/не JSON/);
  });

  it("lease-acquired без deadline не разбирается (обязательность по виду)", () => {
    const line = JSON.stringify({
      kind: "lease-acquired",
      ts: "2026-07-24T13:00:00Z",
      role: "dev-core",
      thread: "t",
    });
    expect(() => parseEventLine(line)).toThrow();
  });

  it("lease-released без reason не разбирается", () => {
    const line = JSON.stringify({
      kind: "lease-released",
      ts: "2026-07-24T13:00:00Z",
      role: "dev-core",
      thread: "t",
    });
    expect(() => parseEventLine(line)).toThrow();
  });

  it("reason вне перечня отвергается", () => {
    const line = JSON.stringify({ ...acquired, kind: "lease-released", reason: "передумал" });
    expect(() => parseEventLine(line)).toThrow();
  });

  it("ts не в UTC-форме отвергается", () => {
    expect(() => parseEventLine(JSON.stringify({ ...acquired, ts: "2026-07-24" }))).toThrow();
  });

  it("неизвестный kind отвергается", () => {
    expect(() => parseEventLine(JSON.stringify({ ...acquired, kind: "выдумка" }))).toThrow();
  });

  it("launch-refused round-trip сохраняет reason", () => {
    const refused: OrchestratorEvent = {
      kind: "launch-refused",
      ts: "2026-07-24T13:00:00Z",
      role: "dev-core",
      thread: "t",
      reason: "run-budget",
    };
    expect(parseEventLine(renderEventLine(refused))).toEqual(refused);
  });

  it("launch-refused без reason не разбирается", () => {
    const line = JSON.stringify({
      kind: "launch-refused",
      ts: "2026-07-24T13:00:00Z",
      role: "dev-core",
      thread: "t",
    });
    expect(() => parseEventLine(line)).toThrow();
  });

  it("launch-refused с reason вне REFUSAL_REASONS отвергается", () => {
    const line = JSON.stringify({
      kind: "launch-refused",
      ts: "2026-07-24T13:00:00Z",
      role: "dev-core",
      thread: "t",
      reason: "надоело",
    });
    expect(() => parseEventLine(line)).toThrow();
  });
});

describe("parseJournal", () => {
  it("читает события по порядку строк, пустые пропускает", () => {
    const released: OrchestratorEvent = {
      kind: "lease-released",
      ts: "2026-07-24T13:10:00Z",
      role: "dev-core",
      thread: "014-reviewer-verdict-delivery",
      reason: "completed",
    };
    const text = `${renderEventLine(acquired)}\n\n${renderEventLine(released)}\n`;
    expect(parseJournal(text)).toEqual([acquired, released]);
  });

  it("пустой текст — пустой журнал", () => {
    expect(parseJournal("")).toEqual([]);
  });
});

describe("renderJournal", () => {
  it("пустой список — пустая строка (append не с чего начинать)", () => {
    expect(renderJournal([])).toBe("");
  });

  it("round-trip через parseJournal", () => {
    const events = [acquired];
    expect(parseJournal(renderJournal(events))).toEqual(events);
  });
});
