import { describe, expect, it } from "vitest";

import type { OrchestratorEvent } from "./journal.js";
import { renderLog } from "./log.js";

describe("renderLog", () => {
  it("an empty journal gives an honest line", () => {
    expect(renderLog([])).toBe("orchestrator: the journal is empty");
  });

  it("a line carries ts, role/thread and kind", () => {
    const events: OrchestratorEvent[] = [
      { kind: "launch", ts: "2026-07-24T14:00:00Z", role: "dev-core", thread: "t" },
    ];
    expect(renderLog(events)).toBe("2026-07-24T14:00:00Z  dev-core/t  launch");
  });

  it("details per kind: deadline, reason", () => {
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

  it("a force stop shows who/when/why (by, note, ts)", () => {
    const events: OrchestratorEvent[] = [
      {
        kind: "stop",
        ts: "2026-07-24T14:10:00Z",
        role: "dev-core",
        thread: "t",
        mode: "forced",
        by: "john",
        note: "the quota is running out",
      },
    ];
    const line = renderLog(events);
    expect(line).toContain("2026-07-24T14:10:00Z");
    expect(line).toContain("forced");
    expect(line).toContain("by john");
    expect(line).toContain("the quota is running out");
  });

  it("a graceful stop without by/note does not break the output", () => {
    const events: OrchestratorEvent[] = [
      { kind: "stop", ts: "2026-07-24T14:10:00Z", role: "dev-core", thread: "t", mode: "graceful" },
    ];
    expect(renderLog(events)).toContain("(graceful)");
  });
});

describe("lease-released: the why, not only the what", () => {
  it("the exit code and the path to the output make it into the line", () => {
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
    expect(line).toContain("code 0");
    expect(line).toContain("sessions/2026-07-24T22-53-15Z-dev-core-012-x.log");
  });

  it("an old record without those fields reads as before", () => {
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
    expect(line).not.toContain("code");
  });
});

describe("the tree a finished run left behind (thread 023)", () => {
  it("a release marked dirty says so in the history — the question is asked of the journal", () => {
    const events: OrchestratorEvent[] = [
      {
        kind: "lease-released",
        ts: "2026-07-30T10:15:00Z",
        role: "dev-core",
        thread: "t",
        reason: "completed",
        dirty: true,
      },
    ];
    expect(renderLog(events)).toContain("LEFT THE WORKSPACE DIRTY");
  });

  it("a release without the flag is rendered exactly as before — silence is not a claim", () => {
    const events: OrchestratorEvent[] = [
      {
        kind: "lease-released",
        ts: "2026-07-30T10:15:00Z",
        role: "dev-core",
        thread: "t",
        reason: "completed",
      },
    ];
    expect(renderLog(events)).toBe("2026-07-30T10:15:00Z  dev-core/t  lease-released (completed)");
  });
});
