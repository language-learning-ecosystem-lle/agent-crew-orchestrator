import { describe, expect, it } from "vitest";

import type { Message } from "./message.js";
import {
  compareMessageEntries,
  isSessionId,
  isWorkerId,
  MessageFormatError,
  messageFileName,
  parseMessageFile,
  renderHeading,
  renderMessageFile,
} from "./message.js";

const FILE = `---
from: dev-core
date: 2026-07-23T13:45:12Z
expects: answer
waiting-on: curator
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
      waitingOn: "curator",
    });
    expect(message.text.startsWith("Message text.")).toBe(true);
  });

  it("tells 'no field' apart from 'waiting lifted'", () => {
    // Three states (john's decision): no field — I am not passing the turn, the
    // waiting is inherited; "—" — the waiting is lifted; a role — the turn is theirs
    // (one, since v13).
    const noField = parseMessageFile(FILE.replace("waiting-on: curator\n", ""));
    const cleared = parseMessageFile(FILE.replace("waiting-on: curator", "waiting-on: —"));

    expect(noField.fields.waitingOn).toBeUndefined();
    expect(cleared.fields.waitingOn).toBeNull();
  });

  it("REFUSES a header naming two roles instead of folding it to the first", () => {
    // The refusal is the point of v13, not a side effect of it: folding would
    // reproduce pain 2 (somebody's unclosed turn evaporating) inside the reader,
    // and quietly. The message names the way out — the migration — because the
    // only files that legitimately carry two are history not yet migrated.
    expect(() =>
      parseMessageFile(FILE.replace("waiting-on: curator", "waiting-on: john, curator")),
    ).toThrow(MessageFormatError);
    expect(() =>
      parseMessageFile(FILE.replace("waiting-on: curator", "waiting-on: john, curator")),
    ).toThrow(/exactly one role since schema v13.*schema migrate/s);
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

describe("provenance in the header (R7)", () => {
  const withProvenance = [
    "---",
    "from: dev-core",
    "worker: claude-code",
    "session: 8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b",
    "date: 2026-07-25T18:00:00Z",
    "expects: answer",
    "waiting-on: curator",
    "---",
    "",
    "body",
    "",
  ].join("\n");

  it("reads what wrote the message alongside who said it", () => {
    const parsed = parseMessageFile(withProvenance);

    expect(parsed.fields.from).toBe("dev-core");
    expect(parsed.fields.worker).toBe("claude-code");
    expect(parsed.fields.session).toBe("8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b");
  });

  it("round-trips: provenance is rendered right after 'from'", () => {
    expect(renderMessageFile(parseMessageFile(withProvenance))).toBe(withProvenance);
  });

  it("is OPTIONAL — history and legacy threads carry none by construction", () => {
    // A `_thread.md` section has no header at all, so a parser that demanded
    // provenance would make every legacy thread unreadable.
    const parsed = parseMessageFile(
      "---\nfrom: john\ndate: 2026-07-21\nexpects: none\n---\n\nbody\n",
    );

    expect(parsed.fields.worker).toBeUndefined();
    expect(parsed.fields.session).toBeUndefined();
  });

  it("but a present value must be well formed — a malformed one fails like a malformed 'from'", () => {
    expect(() =>
      parseMessageFile(
        "---\nfrom: john\nworker: Claude Code\ndate: 2026-07-21\nexpects: none\n---\n\nb\n",
      ),
    ).toThrow(MessageFormatError);
    expect(() =>
      parseMessageFile(
        "---\nfrom: john\nsession: two words\ndate: 2026-07-21\nexpects: none\n---\n\nb\n",
      ),
    ).toThrow(MessageFormatError);
  });

  it("stays out of the assembled heading — the feed is the conversation, not the run", () => {
    const heading = renderHeading(parseMessageFile(withProvenance).fields, 7);

    expect(heading).toBe("## msg-007 · from: dev-core · 2026-07-25 · expects: answer");
  });

  it("accepts a worker nobody has heard of yet: the vocabulary is open on purpose", () => {
    // A closed enum would turn every new tool in the ecosystem into a schema
    // migration of the protocol.
    const parsed = parseMessageFile(
      "---\nfrom: dev-core\nworker: cursor\ndate: 2026-07-25T18:00:00Z\nexpects: none\n---\n\nb\n",
    );

    expect(parsed.fields.worker).toBe("cursor");
    expect(isWorkerId("cursor")).toBe(true);
    expect(isWorkerId("Cursor 2")).toBe(false);
    expect(isSessionId("8f3a2b1c-0d4e")).toBe(true);
    expect(isSessionId("has space")).toBe(false);
  });
});

describe("the priority of a thread in the header (R5)", () => {
  const raw = (line: string): string =>
    `---\nfrom: curator\ndate: 2026-07-26T18:00:00Z\nexpects: answer\nwaiting-on: dev-core\n${line}---\n\nbody\n`;

  it("round-trips: parsed out of the header and rendered back into it", () => {
    const parsed = parseMessageFile(raw("priority: high\n"));

    expect(parsed.fields.priority).toBe("high");
    expect(renderMessageFile(parsed)).toContain("priority: high");
    expect(parseMessageFile(renderMessageFile(parsed)).fields.priority).toBe("high");
  });

  it("absent means absent — no default is invented by the parser", () => {
    // The default (`normal`) belongs to the QUEUE, not to the message: a message that
    // says nothing about priority must be distinguishable from one that says 'normal',
    // otherwise "nobody has spoken" and "somebody chose the middle" collapse into one.
    expect(parseMessageFile(raw("")).fields.priority).toBeUndefined();
  });

  it("a value outside the vocabulary fails the whole message, and the error lists the vocabulary", () => {
    // Unlike `launch`, whose values belong to a foreign tool: this vocabulary is the
    // protocol's own, so a wrong value is a defect and not a message from the future.
    expect(() => parseMessageFile(raw("priority: urgent\n"))).toThrow(MessageFormatError);
    expect(() => parseMessageFile(raw("priority: urgent\n"))).toThrow(/high \| normal \| low/);
  });

  it("stays out of the assembled heading, like the launch directive", () => {
    expect(renderHeading(parseMessageFile(raw("priority: low\n")).fields, 3)).toBe(
      "## msg-003 · from: curator · 2026-07-26 · expects: answer",
    );
  });
});

describe("the park of a turn in the header (R27)", () => {
  const raw = (line: string): string =>
    `---\nfrom: curator\ndate: 2026-07-30T02:00:00Z\nexpects: answer\nwaiting-on: curator\n${line}---\n\nbody\n`;

  it("round-trips beside the turn it qualifies, not instead of it", () => {
    const parsed = parseMessageFile(raw("parked-on: john\n"));

    expect(parsed.fields.parkedOn).toBe("john");
    // The turn does NOT move: this is the one form v13 left unsayable — the role holds
    // the turn AND can do nothing until a person decides.
    expect(parsed.fields.waitingOn).toBe("curator");
    expect(renderMessageFile(parsed)).toContain("parked-on: john");
    expect(parseMessageFile(renderMessageFile(parsed)).fields.parkedOn).toBe("john");
  });

  it("absent is the ordinary case — no field, no freeze", () => {
    expect(parseMessageFile(raw("")).fields.parkedOn).toBeUndefined();
  });

  it("a value that is not a role id is refused as loudly as a malformed 'from'", () => {
    expect(() => parseMessageFile(raw("parked-on: John Smith\n"))).toThrow(MessageFormatError);
  });
});
