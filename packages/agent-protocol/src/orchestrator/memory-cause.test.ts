import { describe, expect, it } from "vitest";

import {
  causeOf,
  extinctionLine,
  isThreadCause,
  planExtinction,
  pruneIndex,
  unansweredCauseLine,
} from "./memory-cause.js";

const note = (body: string): string => `---\n${body}\n---\n\nthe fact itself\n`;

describe("the cause a note declares", () => {
  it("reads `thread:` nested under `metadata:` — the form the vendor writes", () => {
    expect(
      causeOf(
        note(
          "name: a-fact\ndescription: one line\nmetadata:\n  type: project\n  thread: 090-what-kills-a-note",
        ),
      ),
    ).toBe("090-what-kills-a-note");
  });

  it("reads it at the top level too — the form a hand writes, and an indent must not grant immortality", () => {
    expect(causeOf(note("name: a-fact\nthread: 116-role-memory-cost"))).toBe(
      "116-role-memory-cost",
    );
  });

  it("says NOTHING for a note with no cause — that is the long-lived sort, and it is the default", () => {
    expect(causeOf(note("name: a-fact\nmetadata:\n  type: reference"))).toBeUndefined();
  });

  it("does not read a `thread:` from the BODY — only the front matter declares a cause", () => {
    expect(causeOf("no front matter here\nthread: 090-what-kills-a-note\n")).toBeUndefined();
    expect(causeOf(`${note("name: a-fact")}\nthread: 090-what-kills-a-note\n`)).toBeUndefined();
  });

  it("takes a thread id and nothing else as a resolvable cause — the value is spent as a path", () => {
    expect(isThreadCause("090-what-kills-a-note")).toBe(true);
    expect(isThreadCause("047.1-devops-enablement-acceptance")).toBe(true);
    expect(isThreadCause("../../../etc/passwd")).toBe(false);
    expect(isThreadCause("pr:235")).toBe(false);
  });
});

const notes = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("planning the extinction", () => {
  const statusOf = (cause: string) =>
    cause === "016-exhausted-closed-threads"
      ? ("closed" as const)
      : cause === "090-what-kills-a-note"
        ? ("open" as const)
        : undefined;

  it("kills the note whose subject is CLOSED and keeps the one whose subject is open", () => {
    const plan = planExtinction({
      notes: notes({
        "dead.md": note("name: dead\nmetadata:\n  thread: 016-exhausted-closed-threads"),
        "live.md": note("name: live\nmetadata:\n  thread: 090-what-kills-a-note"),
      }),
      statusOf,
    });
    expect(plan.extinguished).toEqual([{ path: "dead.md", cause: "016-exhausted-closed-threads" }]);
    expect(plan.unanswered).toEqual([]);
  });

  it("NEVER touches a note without a cause — the long-lived sort dies only by an explicit hand", () => {
    const plan = planExtinction({
      notes: notes({
        "world.md": note("name: how-the-world-is-built\nmetadata:\n  type: reference"),
        // Even the words of self-cancellation in the text are not a cause: they are prose.
        "stale-looking.md": note("name: устарел\nmetadata:\n  type: project"),
      }),
      statusOf,
    });
    expect(plan).toEqual({ extinguished: [], unanswered: [] });
  });

  it("KEEPS a note whose cause nothing can answer for, and names it — a typo must not delete", () => {
    const plan = planExtinction({
      notes: notes({
        "typo.md": note("name: typo\nmetadata:\n  thread: 999-no-such-thread"),
        "shape.md": note("name: shape\nmetadata:\n  thread: pr:235"),
      }),
      statusOf,
    });
    expect(plan.extinguished).toEqual([]);
    expect(plan.unanswered).toEqual([
      { path: "shape.md", cause: "pr:235" },
      { path: "typo.md", cause: "999-no-such-thread" },
    ]);
  });

  it("never treats the index as a note — it is pruned, not extinguished", () => {
    const plan = planExtinction({
      notes: notes({
        "MEMORY.md": note("thread: 016-exhausted-closed-threads"),
      }),
      statusOf,
    });
    expect(plan).toEqual({ extinguished: [], unanswered: [] });
  });
});

describe("the index goes with the note", () => {
  it("drops the pointer of a removed note by its LINK TARGET and leaves every other line", () => {
    const index = [
      "- [A fact](fact.md) — a hook",
      "- [Dead](dead.md) — a hook about dead.md",
      "- [Another](other.md) — a hook",
      "",
    ].join("\n");
    expect(pruneIndex({ index, removed: ["dead.md"] })).toBe(
      ["- [A fact](fact.md) — a hook", "- [Another](other.md) — a hook", ""].join("\n"),
    );
  });

  it("leaves the index alone when nothing it points at was removed", () => {
    const index = "- [A fact](fact.md) — a hook\n";
    expect(pruneIndex({ index, removed: ["dead.md"] })).toBe(index);
  });
});

describe("the loud lines", () => {
  it("names the note AND the subject that took it", () => {
    expect(
      extinctionLine({
        role: "curator",
        extinguished: [{ path: "dead.md", cause: "016-exhausted-closed-threads" }],
      }),
    ).toBe(
      "memory: 1 note(s) of 'curator' were extinguished by their subject being closed (dead.md ← 016-exhausted-closed-threads) — a note that names a thread lives as long as that thread is open; a note that names none is never extinguished automatically.",
    );
  });

  it("says a cause nothing answers for KEEPS the note, so the reader knows it is not a deletion", () => {
    const said = unansweredCauseLine({
      role: "dev-core",
      unanswered: [{ path: "typo.md", cause: "999-no-such-thread" }],
    });
    expect(said).toContain("typo.md → 999-no-such-thread");
    expect(said).toContain("they are KEPT");
  });
});
