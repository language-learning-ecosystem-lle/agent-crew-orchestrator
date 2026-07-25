import { describe, expect, it } from "vitest";

import type { Message } from "./message.js";
import {
  compareMessageEntries,
  messageFileName,
  parseMessageFile,
  renderHeading,
  renderMessageFile,
} from "./message.js";

const FILE = `---
from: dev-core
date: 2026-07-23T13:45:12Z
expects: answer
waiting-on: john, curator
---

Message text.

waiting-on is declared as a field, not as prose.
`;

describe("parseMessageFile", () => {
  it("parses the header and the body", () => {
    const message = parseMessageFile(FILE);

    expect(message.fields).toEqual({
      from: "dev-core",
      date: "2026-07-23T13:45:12Z",
      expects: "answer",
      waitingOn: ["john", "curator"],
    });
    expect(message.text.startsWith("Message text.")).toBe(true);
  });

  it("tells 'no field' apart from 'waiting lifted'", () => {
    // Three states (john's decision): no field — I am not passing the turn, the
    // waiting is inherited; "—" — the waiting is lifted; a list — the full
    // remaining set.
    const noField = parseMessageFile(FILE.replace("waiting-on: john, curator\n", ""));
    const cleared = parseMessageFile(FILE.replace("waiting-on: john, curator", "waiting-on: —"));

    expect(noField.fields.waitingOn).toBeUndefined();
    expect(cleared.fields.waitingOn).toEqual([]);
  });

  it("rejects a file without a header, without required fields and with a foreign expects", () => {
    expect(() => parseMessageFile("just text")).toThrow(/'---'/);
    expect(() => parseMessageFile("---\nfrom: dev-core\n---\n\ntext\n")).toThrow(/are required/);
    expect(() => parseMessageFile(FILE.replace("expects: answer", "expects: maybe"))).toThrow(
      /expects/,
    );
  });

  it("rejects a timestamp that is not in the UTC form", () => {
    expect(() =>
      parseMessageFile(FILE.replace("2026-07-23T13:45:12Z", "23.07.2026 13:45")),
    ).toThrow(/UTC stamp/);
  });

  it("parse → render round-trip does not change the file", () => {
    expect(renderMessageFile(parseMessageFile(FILE))).toBe(FILE);
  });
});

describe("messageFileName", () => {
  it("a new message — timestamp and role", () => {
    expect(
      messageFileName({ from: "curator", date: "2026-07-23T13:45:12Z", expects: "answer" }),
    ).toBe("2026-07-23T13-45-12Z-curator.md");
  });

  it("a migrated one — the name comes from the POSITION (seq), not from the historical number", () => {
    // The number (msg) is duplicated and would reorder messages on sorting; the
    // name takes seq (position), the number stays in the heading only.
    const migrated = messageFileName({
      msg: 2,
      seq: 3,
      from: "curator",
      date: "2026-07-23",
      expects: "answer",
    });
    const fresh = messageFileName({
      from: "curator",
      date: "2026-07-23T13:45:12Z",
      expects: "answer",
    });

    expect(migrated).toBe("2026-07-23-003-curator.md");
    expect([fresh, migrated].sort()).toEqual([migrated, fresh]);
  });

  it("a migrated one without seq is an error (a name cannot be built from a number alone)", () => {
    expect(() =>
      messageFileName({ msg: 2, from: "curator", date: "2026-07-23", expects: "answer" }),
    ).toThrow(/no 'seq'/);
  });
});

describe("renderHeading", () => {
  it("prints the historical number for a migrated message and the position for a new one", () => {
    const legacy = renderHeading(
      { msg: 5, from: "curator", date: "2026-07-21", expects: "none" },
      99,
    );
    const fresh = renderHeading(
      { from: "dev-core", date: "2026-07-23T13:45:12Z", expects: "answer" },
      7,
    );

    expect(legacy).toBe("## msg-005 · from: curator · 2026-07-21 · expects: none");
    expect(fresh).toBe("## msg-007 · from: dev-core · 2026-07-23 · expects: answer");
  });

  it("preserves the historical heading tail", () => {
    const heading = renderHeading(
      {
        msg: 1,
        from: "curator",
        date: "2026-07-22",
        expects: "none",
        suffix: "[СВЕРХПИСАНО msg-002]",
      },
      1,
    );

    expect(heading).toBe(
      "## msg-001 · from: curator · 2026-07-22 · expects: none · [СВЕРХПИСАНО msg-002]",
    );
  });
});

describe("compareMessageEntries", () => {
  const entry = (
    fileName: string,
    fields: Message["fields"],
  ): { fileName: string; message: Message } => ({
    fileName,
    message: { fields, text: "x" },
  });

  it("orders by seq, not by name: later in the feed with an earlier date is still later", () => {
    // A mini repro of 012: a migrated name leads with a date, github's date
    // 07-23 < 07-24, so sorting by NAME would put it first. seq (2 > 1) holds the
    // feed order.
    const late = entry("2026-07-23-002-github.md", {
      msg: 2,
      seq: 2,
      from: "github",
      date: "2026-07-23",
      expects: "none",
    });
    const early = entry("2026-07-24-001-curator.md", {
      msg: 1,
      seq: 1,
      from: "curator",
      date: "2026-07-24",
      expects: "answer",
    });

    expect([late, early].sort(compareMessageEntries).map((e) => e.message.fields.seq)).toEqual([
      1, 2,
    ]);
  });

  it("new ones (without seq) come after migrated ones, and among themselves by name", () => {
    const migrated = entry("2026-07-24-001-curator.md", {
      msg: 1,
      seq: 1,
      from: "curator",
      date: "2026-07-24",
      expects: "answer",
    });
    const freshEarly = entry("2026-07-25T09-00-00Z-dev-core.md", {
      from: "dev-core",
      date: "2026-07-25T09:00:00Z",
      expects: "answer",
    });
    const freshLate = entry("2026-07-25T10-00-00Z-curator.md", {
      from: "curator",
      date: "2026-07-25T10:00:00Z",
      expects: "answer",
    });

    expect(
      [freshLate, freshEarly, migrated].sort(compareMessageEntries).map((e) => e.fileName),
    ).toEqual([migrated.fileName, freshEarly.fileName, freshLate.fileName]);
  });
});
