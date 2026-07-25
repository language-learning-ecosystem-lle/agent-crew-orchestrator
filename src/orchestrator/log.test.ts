import { describe, expect, it } from "vitest";

import type { OrchestratorEvent } from "./journal.js";
import { renderLog } from "./log.js";

describe("renderLog", () => {
  it("пустой журнал — честная строка", () => {
    expect(renderLog([])).toBe("оркестратор: журнал пуст");
  });

  it("строка несёт ts, role/thread и kind", () => {
    const events: OrchestratorEvent[] = [
      { kind: "launch", ts: "2026-07-24T14:00:00Z", role: "dev-core", thread: "t" },
    ];
    expect(renderLog(events)).toBe("2026-07-24T14:00:00Z  dev-core/t  launch");
  });

  it("детали по видам: deadline, reason", () => {
    const events: OrchestratorEvent[] = [
      {
        kind: "lease-acquired",
        ts: "2026-07-24T14:00:00Z",
        role: "dev-core",
        thread: "t",
        deadline: "2026-07-24T14:15:00Z",
      },
      {
        kind: "lease-released",
        ts: "2026-07-24T14:05:00Z",
        role: "dev-core",
        thread: "t",
        reason: "completed",
      },
    ];
    const out = renderLog(events).split("\n");
    expect(out[0]).toContain("(deadline 2026-07-24T14:15:00Z)");
    expect(out[1]).toContain("(completed)");
  });

  it("force-стоп показывает кто/когда/почему (by, note, ts)", () => {
    const events: OrchestratorEvent[] = [
      {
        kind: "stop",
        ts: "2026-07-24T14:10:00Z",
        role: "dev-core",
        thread: "t",
        mode: "forced",
        by: "john",
        note: "квота на исходе",
      },
    ];
    const line = renderLog(events);
    expect(line).toContain("2026-07-24T14:10:00Z");
    expect(line).toContain("forced");
    expect(line).toContain("by john");
    expect(line).toContain("квота на исходе");
  });

  it("graceful-стоп без by/note не ломает вывод", () => {
    const events: OrchestratorEvent[] = [
      { kind: "stop", ts: "2026-07-24T14:10:00Z", role: "dev-core", thread: "t", mode: "graceful" },
    ];
    expect(renderLog(events)).toContain("(graceful)");
  });
});

describe("lease-released: почему, а не только что", () => {
  it("код выхода и путь к выводу попадают в строку", () => {
    const line = renderLog([
      {
        kind: "lease-released",
        ts: "2026-07-24T22:58:36Z",
        role: "dev-core",
        thread: "012-x",
        reason: "exited-without-handoff",
        exitCode: 0,
        output: "/repo/.orchestrator/sessions/2026-07-24T22-53-15Z-dev-core-012-x.log",
      },
    ]);
    expect(line).toContain("exited-without-handoff");
    expect(line).toContain("код 0");
    expect(line).toContain("sessions/2026-07-24T22-53-15Z-dev-core-012-x.log");
  });

  it("старая запись без этих полей читается как прежде", () => {
    const line = renderLog([
      {
        kind: "lease-released",
        ts: "2026-07-24T22:58:36Z",
        role: "dev-core",
        thread: "012-x",
        reason: "completed",
      },
    ]);
    expect(line).toContain("(completed)");
    expect(line).not.toContain("код");
  });
});
