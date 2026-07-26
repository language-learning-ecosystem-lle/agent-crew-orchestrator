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
  it("the round-trip preserves the event", () => {
    expect(parseEventLine(renderEventLine(acquired))).toEqual(acquired);
  });

  it("a malformed line — a loud refusal, not a skip", () => {
    expect(() => parseEventLine("not json")).toThrow(/not JSON/);
  });

  it("lease-acquired without a deadline does not parse (required per kind)", () => {
    const line = JSON.stringify({
      kind: "lease-acquired",
      ts: "2026-07-24T13:00:00Z",
      role: "dev-core",
      thread: "t",
    });
    expect(() => parseEventLine(line)).toThrow();
  });

  it("lease-released without a reason does not parse", () => {
    const line = JSON.stringify({
      kind: "lease-released",
      ts: "2026-07-24T13:00:00Z",
      role: "dev-core",
      thread: "t",
    });
    expect(() => parseEventLine(line)).toThrow();
  });

  it("a reason outside the list is rejected", () => {
    const line = JSON.stringify({ ...acquired, kind: "lease-released", reason: "changed my mind" });
    expect(() => parseEventLine(line)).toThrow();
  });

  it("a ts not in UTC form is rejected", () => {
    expect(() => parseEventLine(JSON.stringify({ ...acquired, ts: "2026-07-24" }))).toThrow();
  });

  it("an unknown kind is rejected", () => {
    expect(() => parseEventLine(JSON.stringify({ ...acquired, kind: "made up" }))).toThrow();
  });

  it("launch-refused round-trip preserves the reason", () => {
    const refused: OrchestratorEvent = {
      kind: "launch-refused",
      ts: "2026-07-24T13:00:00Z",
      role: "dev-core",
      thread: "t",
      reason: "run-budget",
    };
    expect(parseEventLine(renderEventLine(refused))).toEqual(refused);
  });

  it("launch-refused without a reason does not parse", () => {
    const line = JSON.stringify({
      kind: "launch-refused",
      ts: "2026-07-24T13:00:00Z",
      role: "dev-core",
      thread: "t",
    });
    expect(() => parseEventLine(line)).toThrow();
  });

  it("launch-refused with a reason outside REFUSAL_REASONS is rejected", () => {
    const line = JSON.stringify({
      kind: "launch-refused",
      ts: "2026-07-24T13:00:00Z",
      role: "dev-core",
      thread: "t",
      reason: "got bored",
    });
    expect(() => parseEventLine(line)).toThrow();
  });

  it("stop forced with by/note (who/why) round-trips", () => {
    const stop: OrchestratorEvent = {
      kind: "stop",
      ts: "2026-07-24T13:00:00Z",
      role: "dev-core",
      thread: "t",
      mode: "forced",
      by: "john",
      note: "the quota is running out",
    };
    expect(parseEventLine(renderEventLine(stop))).toEqual(stop);
  });

  it("stop graceful without by/note parses (they are optional)", () => {
    const stop: OrchestratorEvent = {
      kind: "stop",
      ts: "2026-07-24T13:00:00Z",
      role: "dev-core",
      thread: "t",
      mode: "graceful",
    };
    expect(parseEventLine(renderEventLine(stop))).toEqual(stop);
  });
});

describe("the events of an interactive turn (R19)", () => {
  it("input-awaited round-trips WITH the limit of the wait", () => {
    const parked: OrchestratorEvent = {
      kind: "input-awaited",
      ts: "2026-07-26T10:00:00Z",
      role: "dev-core",
      thread: "016-x",
      deadline: "2026-07-26T11:00:00Z",
    };
    expect(parseEventLine(renderEventLine(parked))).toEqual(parked);
  });

  it("input-awaited WITHOUT a deadline does not parse — a park with no limit is not a state", () => {
    const line = JSON.stringify({
      kind: "input-awaited",
      ts: "2026-07-26T10:00:00Z",
      role: "dev-core",
      thread: "016-x",
    });
    expect(() => parseEventLine(line)).toThrow();
  });

  it("input-received round-trips as a bare event", () => {
    const back: OrchestratorEvent = {
      kind: "input-received",
      ts: "2026-07-26T10:30:00Z",
      role: "dev-core",
      thread: "016-x",
    };
    expect(parseEventLine(renderEventLine(back))).toEqual(back);
  });

  it("the two endings of a park are release reasons of their own", () => {
    for (const reason of ["input-timeout", "exited-while-waiting"] as const) {
      const released: OrchestratorEvent = {
        kind: "lease-released",
        ts: "2026-07-26T11:00:00Z",
        role: "dev-core",
        thread: "016-x",
        reason,
      };
      expect(parseEventLine(renderEventLine(released))).toEqual(released);
    }
  });
});

describe("the continuation fields (R18)", () => {
  const base = { ts: "2026-07-24T13:00:00Z", role: "dev-core", thread: "016-x" };

  it("a launch carries the mode, the resumed session and the world — round-trip", () => {
    const event: OrchestratorEvent = {
      kind: "launch",
      ...base,
      mode: "resume",
      resumes: "8f3a2b1c",
      world: { base: "7923ada0", mine: "2026-07-24T12-00-00Z-dev-core.md" },
    };

    expect(parseEventLine(renderEventLine(event))).toEqual(event);
  });

  it("a role that had not spoken yet records an EMPTY mark, and it survives the round-trip", () => {
    // `""` is a fact ("it had written nothing here"), and it has to be told apart from
    // an absent mark ("nobody wrote down what it had said") — the second is never
    // resumed, the first is resumable.
    const event: OrchestratorEvent = {
      kind: "launch",
      ...base,
      mode: "fresh",
      world: { base: "7923ada0", mine: "" },
    };

    expect(parseEventLine(renderEventLine(event))).toEqual(event);
  });

  it("a world written by the FIRST version of R18 still parses — the tree id is simply dropped", () => {
    // Journals are never rewritten. Those runs have no mark, and the policy reads that
    // as "start fresh" rather than as a resumable world.
    const old = JSON.stringify({
      kind: "launch",
      ...base,
      world: { thread: "7472b754", base: "7923ada0" },
    });

    expect(parseEventLine(old)).toEqual({ kind: "launch", ...base, world: { base: "7923ada0" } });
  });

  it("a release carries the session id and the steps burned — round-trip", () => {
    const event: OrchestratorEvent = {
      kind: "lease-released",
      ...base,
      reason: "stalled",
      session: "8f3a2b1c",
      steps: 41,
    };

    expect(parseEventLine(renderEventLine(event))).toEqual(event);
  });

  it("A JOURNAL WRITTEN BEFORE R18 STILL PARSES — the fields are optional", () => {
    // The whole reason no journal is rewritten by the migration: those runs simply
    // carry no world, and the policy reads that as "start fresh".
    const old = JSON.stringify({ kind: "launch", ...base });

    expect(parseEventLine(old)).toEqual({ kind: "launch", ...base });
  });

  it("a half-written world does not parse: an id nobody can compare is worse than none", () => {
    const line = JSON.stringify({ kind: "launch", ...base, world: { thread: "abc" } });

    expect(() => parseEventLine(line)).toThrow();
  });

  it("a mode outside fresh/resume is rejected", () => {
    const line = JSON.stringify({ kind: "launch", ...base, mode: "continue" });

    expect(() => parseEventLine(line)).toThrow();
  });
});

describe("parseJournal", () => {
  it("reads events in line order, skipping empty lines", () => {
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

  it("empty text — an empty journal", () => {
    expect(parseJournal("")).toEqual([]);
  });
});

describe("renderJournal", () => {
  it("an empty list — an empty string (nothing to append onto)", () => {
    expect(renderJournal([])).toBe("");
  });

  it("round-trip through parseJournal", () => {
    const events = [acquired];
    expect(parseJournal(renderJournal(events))).toEqual(events);
  });
});
