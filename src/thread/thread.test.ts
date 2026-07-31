import { describe, expect, it } from "vitest";

import { parkedThreads, renderIndex, threadsWaitingOn } from "./index-doc.js";
import type { Message } from "./message.js";
import { migrateLegacyThread, verifyMigration } from "./migrate.js";
import {
  declaredWaitingOn,
  parkedOnKind,
  parkedOnOf,
  parkingOf,
  parseLegacyThread,
  parseMetaFile,
  questionOf,
  renderMetaFile,
  renderThread,
  type Thread,
  updatedOf,
  waitingOnOf,
} from "./thread.js";

const ROLES = ["john", "curator", "dev-core", "dev-speech", "reviewer-pr", "github"];

// A cast of a live thread: two sections, a waiting declaration written as prose
// with an arrow, a historical heading tail and prose containing the word
// waiting-on WITHOUT an arrow.
const LEGACY = `# 012-agent-protocol-package · Moving the protocol into a package

participants: curator, dev-core, john · status: open

## msg-001 · from: curator · 2026-07-23 · expects: answer · [СВЕРХПИСАНО msg-002]

The statement of work. With a non-empty waiting-on the generator takes the last declaration.

waiting-on → dev-core.

## msg-002 · from: dev-core · 2026-07-23 · expects: none

Done, the PR is open.

waiting-on → john (merge), curator (statement of work).
`;

describe("parseLegacyThread", () => {
  it("parses the header, the sections and the waiting declarations", () => {
    const thread = parseLegacyThread("012-x", LEGACY, ROLES);

    expect(thread.meta).toEqual({
      title: "012-agent-protocol-package · Moving the protocol into a package",
      participants: ["curator", "dev-core", "john"],
      status: "open",
    });
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0]?.fields.suffix).toBe("[СВЕРХПИСАНО msg-002]");
    expect(thread.messages[1]?.fields.waitingOn).toBe("john");
  });

  it("fails on a non-standard header instead of guessing it", () => {
    expect(() => parseLegacyThread("012-x", "# title only\n", ROLES)).toThrow(/header/);
  });

  it("does not cut a section at a '## msg-' line quoted inside a fenced block", () => {
    const quoting = LEGACY.replace(
      "Done, the PR is open.",
      [
        "Done, the PR is open. The ordinal is not an identifier:",
        "",
        "```",
        "$ cli thread show --thread 024-scalar-waiting-on --tail 7 | grep '^## msg-'",
        "## msg-001 · from: reviewer-pr · 2026-07-29 · expects: answer",
        "```",
      ].join("\n"),
    );

    const thread = parseLegacyThread("012-x", quoting, ROLES);

    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]?.text).toContain("## msg-001 · from: reviewer-pr");
    expect(thread.messages[1]?.fields.waitingOn).toBe("john");
  });
});

describe("declaredWaitingOn", () => {
  it("counts only an arrow immediately after the word as a declaration", () => {
    expect(declaredWaitingOn("waiting-on stays with john", ROLES)).toBeUndefined();
    expect(declaredWaitingOn("waiting-on → john", ROLES)).toBe("john");
  });

  it("takes the last declaration, not the first", () => {
    const text = "waiting-on → john\n\nthen we changed our minds\n\nwaiting-on → curator";

    expect(declaredWaitingOn(text, ROLES)).toBe("curator");
  });

  it("does not lose a role because of a parenthesised explanation", () => {
    // Thread 011: the hypothesis "parentheses eat the next role" was checked by fact.
    expect(declaredWaitingOn("waiting-on → dev-speech (stage 1), john", ROLES)).toBe("dev-speech");
  });

  it("cuts at the last waiting-on word, not at the first arrow in the line", () => {
    // The arrow is a common character in prose (@BotFather → chat_id → chmod 600).
    const text = "setup: @BotFather → token → chmod 600. waiting-on → john";

    expect(declaredWaitingOn(text, ROLES)).toBe("john");
  });

  it("a declaration without known roles yields an empty set, not the absence of a declaration", () => {
    expect(declaredWaitingOn("waiting-on → —", ROLES)).toBeNull();
  });
});

describe("waitingOnOf", () => {
  it("takes the last DECLARATION even if the last section did not pass the turn", () => {
    const thread = parseLegacyThread("012-x", LEGACY, ROLES);
    const withNote = {
      ...thread,
      messages: [
        ...thread.messages,
        {
          fields: { msg: 3, from: "github", date: "2026-07-23", expects: "none" as const },
          text: "The PR is merged.",
        },
      ],
    };

    expect(waitingOnOf(withNote)).toBe("john");
  });

  it("a closed thread awaits nobody, whatever the last section says", () => {
    const thread = parseLegacyThread(
      "012-x",
      LEGACY.replace("status: open", "status: closed"),
      ROLES,
    );

    expect(waitingOnOf(thread)).toBeUndefined();
  });
});

describe("renderThread / _meta.md", () => {
  it("the assembly reproduces the original thread byte for byte", () => {
    const thread = parseLegacyThread("012-x", LEGACY, ROLES);

    expect(renderThread(thread.meta, thread.messages)).toBe(LEGACY);
  });

  it("_meta.md is parsed and rendered back", () => {
    const thread = parseLegacyThread("012-x", LEGACY, ROLES);
    const raw = renderMetaFile(thread.meta);

    expect(parseMetaFile(raw)).toEqual(thread.meta);
  });
});

describe("renderIndex / threadsWaitingOn", () => {
  // The INDEX heading is deliberately left in the project zone's language — see
  // the note in `index-doc.ts`.
  it("the index is assembled from the threads, a closed one shows '—'", () => {
    const open = parseLegacyThread("012-x", LEGACY, ROLES);
    const closed = parseLegacyThread(
      "001-y",
      LEGACY.replace("status: open", "status: closed"),
      ROLES,
    );

    expect(renderIndex([closed, open])).toBe(
      `# Реестр разговоров

| id | participants | status | waiting-on | updated |
|---|---|---|---|---|
| 001-y | curator, dev-core, john | closed | — | 2026-07-23 |
| 012-x | curator, dev-core, john | open | john | 2026-07-23 |
`,
    );
  });

  it("mail is computed from the threads, not from the index", () => {
    // If "is there mail" were read from the derived INDEX, a failure of its
    // generator would mean the circuit goes blind — pain 5 (thread 008).
    const thread = parseLegacyThread("012-x", LEGACY, ROLES);

    expect(threadsWaitingOn([thread], "john")).toEqual(["012-x"]);
    expect(threadsWaitingOn([thread], "dev-core")).toEqual([]);
  });

  it("updated is the date of the last message", () => {
    expect(updatedOf(parseLegacyThread("012-x", LEGACY, ROLES))).toBe("2026-07-23");
  });
});

describe("migrateLegacyThread", () => {
  it("splits the thread into files and reproduces the original byte for byte", () => {
    const migration = migrateLegacyThread("012-x", LEGACY, ROLES);

    expect(migration.files.map((file) => file.path)).toEqual([
      "_meta.md",
      "messages/2026-07-23-001-curator.md",
      "messages/2026-07-23-002-dev-core.md",
      "_thread.md",
    ]);
    expect(verifyMigration(migration, LEGACY)).toBeUndefined();
  });

  it("a duplicated historical number does NOT break the order and does NOT collide (the name comes from seq)", () => {
    // Regression: before seq the name was built from the number, and two msg-002
    // (dev-core, curator) produced files `002-dev-core`/`002-curator` which the
    // sort reordered (c < d) — loading from disk lied about the order. The second
    // condition of verifyMigration (a round-trip through name sorting) now catches
    // this.
    const dup = `# 012-x · duplicated number

participants: curator, dev-core · status: open

## msg-001 · from: curator · 2026-07-23 · expects: answer

First.

## msg-002 · from: dev-core · 2026-07-23 · expects: answer

Second (dev-core before curator).

## msg-002 · from: curator · 2026-07-23 · expects: none

Third, the same number.
`;
    const migration = migrateLegacyThread("012-x", dup, ["curator", "dev-core"]);

    // Names from positions 1/2/3 — sorting matches the order, no collisions.
    expect(migration.files.map((file) => file.path)).toEqual([
      "_meta.md",
      "messages/2026-07-23-001-curator.md",
      "messages/2026-07-23-002-dev-core.md",
      "messages/2026-07-23-003-curator.md",
      "_thread.md",
    ]);
    expect(migration.collisions).toEqual([]);
    // Both conditions of the guard, including the round-trip through name sorting.
    expect(verifyMigration(migration, dup)).toBeUndefined();
  });

  it("the guard shows where the divergence is, not just 'did not match'", () => {
    const migration = migrateLegacyThread("012-x", LEGACY, ROLES);
    const tampered = LEGACY.replace("Done, the PR is open.", "Done, the PR is open!");

    expect(verifyMigration(migration, tampered)).toMatch(/divergence at byte \d+/);
  });
});

describe("parkedOnOf — the turn frozen behind a person (R27)", () => {
  const parked = (fields: Partial<Message["fields"]>): Thread => ({
    id: "023-x",
    meta: { title: "t", participants: ["curator", "john"], status: "open" },
    messages: [
      {
        fields: {
          from: "curator",
          date: "2026-07-30T01:00:00Z",
          expects: "answer",
          parkedOn: "john",
        },
        text: "The question is john's.",
      },
      {
        fields: { from: "curator", date: "2026-07-30T02:00:00Z", expects: "answer", ...fields },
        text: "later",
      },
    ],
  });

  it("stands while the last substantive message repeats it", () => {
    expect(parkedOnOf(parked({ parkedOn: "john" }))).toBe("john");
  });

  it("lifts by itself on the next substantive message — nobody has to unpark it", () => {
    // The session that parked the thread is dead by the time the answer lands, so the
    // state cannot depend on it coming back to clear the flag.
    expect(parkedOnOf(parked({}))).toBeUndefined();
  });

  it("an announcement of the circuit does NOT lift it — a green CI run is not a decision", () => {
    const thread = parked({ from: "github", worker: "gh-action", expects: "none" });
    expect(parkedOnOf(thread)).toBe("john");
  });

  it("a participant speaking lifts it even with 'expects: none' — the decision relayed", () => {
    // Thread 023, three live repros (040, 044, 016): curator relaying john's decision and
    // handing the turn on writes 'expects: none' — it asks nobody for anything — and the
    // thread stayed frozen with the answer already in it. The author is what separates the
    // circuit's noise from a person: only 'worker: gh-action' is skipped.
    const thread = parked({ from: "curator", worker: "claude-ai", expects: "none" });
    expect(parkedOnOf(thread)).toBeUndefined();
  });

  it("a message with no worker at all is a participant — the skip is positive identification", () => {
    expect(parkedOnOf(parked({ from: "curator", expects: "none" }))).toBeUndefined();
  });

  it("a park DECLARED ON an informational message acts — the field is read before the skip", () => {
    // Thread 034, paid for twice with empty sessions: 'expects: none' used to be skipped
    // before the field was looked at, so this park was invisible and the pair was raised
    // into a thread waiting for a human. The door refuses the combination now; the ones
    // already lying in the feed act.
    const thread = parked({ from: "curator", expects: "none", parkedOn: "john" });
    expect(parkedOnOf(thread)).toBe("john");
  });

  it("a closed thread is parked behind nobody", () => {
    const thread = parked({ parkedOn: "john" });
    expect(parkedOnOf({ ...thread, meta: { ...thread.meta, status: "closed" } })).toBeUndefined();
  });

  it("an unparked thread is the ordinary case — no field, no freeze", () => {
    const thread = parked({});
    expect(parkedOnOf({ ...thread, messages: [thread.messages[1] as Message] })).toBeUndefined();
  });
});

describe("parkedThreads — what the planner is told (R27)", () => {
  const thread = (id: string, parkedOn?: string): Thread => ({
    id,
    meta: { title: id, participants: ["curator", "john"], status: "open" },
    messages: [
      {
        fields: {
          from: "curator",
          date: "2026-07-30T01:00:00Z",
          expects: "answer",
          waitingOn: "curator",
          ...(parkedOn === undefined ? {} : { parkedOn }),
        },
        text: "x",
      },
    ],
  });

  it("names the person, thread by thread, and leaves the unparked ones out", () => {
    const map = parkedThreads([thread("023-a", "john"), thread("025-b")]);
    expect([...map]).toEqual([["023-a", "john"]]);
  });

  it("a parked thread is STILL mail — the mailbox and the notifier must keep seeing it", () => {
    const threads = [thread("023-a", "john")];
    expect(threadsWaitingOn(threads, "curator")).toEqual(["023-a"]);
  });

  it("carries an EVENT park raw, so the readers can word it as a merge (thread 023)", () => {
    const map = parkedThreads([thread("023-a", "pr:127"), thread("025-b", "john")]);
    expect([...map]).toEqual([
      ["023-a", "pr:127"],
      ["025-b", "john"],
    ]);
  });
});

describe("parkedOnKind — the one reading of the field (thread 023)", () => {
  it("a role id is a person", () => {
    expect(parkedOnKind("john")).toEqual({ kind: "person", person: "john" });
  });

  it("'pr:N' is the merge that lifts the park", () => {
    expect(parkedOnKind("pr:127")).toEqual({ kind: "event", pr: 127 });
  });

  it("only the exact form is an event — a person is never guessed away", () => {
    // The namespace is a prefix of a WHOLE value: 'pr:12x' and 'pr-reviewer' are names, and a
    // reader that half-matched them would announce a merge of a PR that does not exist.
    expect(parkedOnKind("pr:12x").kind).toBe("person");
    expect(parkedOnKind("pr-reviewer").kind).toBe("person");
    expect(parkedOnKind("pr:").kind).toBe("person");
  });
});

describe("parkingOf — the facts the courier to the human needs (thread 023)", () => {
  const thread = (text: string): Thread => ({
    id: "023-x",
    meta: { title: "t", participants: ["curator", "john"], status: "open" },
    messages: [
      {
        fields: {
          from: "curator",
          date: "2026-07-31T11:08:20Z",
          expects: "answer",
          waitingOn: "curator",
          parkedOn: "john",
        },
        text,
      },
    ],
  });

  it("names the person, the stamp of the parking message and its first line", () => {
    expect(parkingOf(thread("**Перезапустить демон?**\n\nПодробности ниже."))).toEqual({
      kind: "person",
      person: "john",
      since: "2026-07-31T11:08:20Z",
      question: "Перезапустить демон?",
    });
  });

  it("the question is the first line WITHOUT its markup — a heading is still a question", () => {
    expect(questionOf("## Вопрос: чинить ли гард 2?\n\nтело")).toBe("Вопрос: чинить ли гард 2?");
    expect(questionOf("\n\n- первый пункт\nвторой")).toBe("первый пункт");
    expect(questionOf("   \n")).toBe("");
  });

  it("a long first line is cut to one line — a notification is read on a phone", () => {
    const long = questionOf("ы".repeat(400));
    expect(long.length).toBeLessThanOrEqual(140);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("parkingOf — a park on an EVENT (thread 023, variant A)", () => {
  const message = (fields: Partial<Message["fields"]>, text = "тело"): Message => ({
    fields: {
      from: "dev-core",
      date: "2026-07-31T12:00:00Z",
      expects: "answer",
      waitingOn: "dev-core",
      ...fields,
    } as Message["fields"],
    text,
  });
  const thread = (messages: readonly Message[]): Thread => ({
    id: "023-x",
    meta: { title: "t", participants: ["curator", "dev-core"], status: "open" },
    messages,
  });

  it("names the PR the turn waits for, not a person", () => {
    expect(
      parkingOf(thread([message({ parkedOn: "pr:127" }, "Жду merge #127.\n\nдалее")])),
    ).toEqual({
      kind: "event",
      pr: 127,
      since: "2026-07-31T12:00:00Z",
      question: "Жду merge #127.",
    });
  });

  it("the merge notifier lifts it, though the announcement is informational", () => {
    const parked = message({ parkedOn: "pr:127" });
    const merged = message(
      {
        from: "github",
        worker: "gh-action",
        expects: "none",
        date: "2026-07-31T12:30:00Z",
        mergedPr: 127,
      },
      "PR #127 merged",
    );
    expect(parkingOf(thread([parked, merged]))).toBeUndefined();
  });

  it("somebody else's merge lifts nothing", () => {
    const parked = message({ parkedOn: "pr:127" });
    const merged = message(
      {
        from: "github",
        worker: "gh-action",
        expects: "none",
        date: "2026-07-31T12:30:00Z",
        mergedPr: 129,
      },
      "PR #129 merged",
    );
    expect(parkingOf(thread([parked, merged]))?.pr).toBe(127);
  });

  it("an announcement BEFORE the park does not lift it — a park is a later statement", () => {
    const merged = message(
      {
        from: "github",
        worker: "gh-action",
        expects: "none",
        date: "2026-07-31T11:00:00Z",
        mergedPr: 127,
      },
      "PR #127 merged",
    );
    const parked = message({ parkedOn: "pr:127" });
    expect(parkingOf(thread([merged, parked]))?.kind).toBe("event");
  });

  it("parkedOnOf keeps the raw value, so the skip line can tell the two apart", () => {
    expect(parkedOnOf(thread([message({ parkedOn: "pr:127" })]))).toBe("pr:127");
  });
});
