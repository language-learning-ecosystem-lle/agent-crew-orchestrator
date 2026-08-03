import { describe, expect, it } from "vitest";

import { parkedThreads, renderIndex, threadsWaitingOn } from "./index-doc.js";
import type { Message } from "./message.js";
import { migrateLegacyThread, verifyMigration } from "./migrate.js";
import {
  declaredWaitingOn,
  mergedPrs,
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

  it("AN ANNOUNCEMENT OF THE CIRCUIT LIFTS IT TOO — the fact arriving is still the answer", () => {
    // Live repro 046 (thread 023, curator's measurement of a day): the park named a person,
    // the notifier reported the merge of the very PR that person's decision was about, and
    // the thread stood frozen for twelve more hours because the fact came from the circuit
    // rather than from a person's hand relaying it.
    const thread = parked({ from: "github", worker: "gh-action", expects: "none" });
    expect(parkedOnOf(thread)).toBeUndefined();
  });

  it("a participant speaking lifts it even with 'expects: none' — the decision relayed", () => {
    // Thread 023, three live repros (040, 044, 016): curator relaying john's decision and
    // handing the turn on writes 'expects: none' — it asks nobody for anything — and the
    // thread stayed frozen with the answer already in it.
    const thread = parked({ from: "curator", worker: "claude-ai", expects: "none" });
    expect(parkedOnOf(thread)).toBeUndefined();
  });

  it("THE PARKER'S OWN ROLE LIFTS IT — the doubles of a role are one author in the header", () => {
    // A role writes both from a raised session and from a human's chat ('worker' differs,
    // 'from' does not), and the chat one is exactly the courier delivering the decision the
    // park waits for. Nothing in the header tells the two apart, and under this rule nothing
    // has to (thread 023, curator's open question).
    expect(parkedOnOf(parked({ from: "curator", worker: "claude-ai" }))).toBeUndefined();
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

  it("THE MERGE LIFTS THE PARK FROM ANOTHER THREAD — the planner reads the whole mail", () => {
    // What the planner is told is computed over the mail, not thread by thread: the notifier
    // announces a merge into the thread named in the PR's description (here 046), while the
    // thread frozen on it is another one (042 ↔ `pr:133`, live, thread 023).
    const announcement: Message = {
      fields: {
        from: "github",
        date: "2026-07-31T16:31:00Z",
        expects: "none",
        worker: "gh-action",
        mergedPr: 133,
      } as Message["fields"],
      text: "PR #133 merged",
    };
    const elsewhere: Thread = {
      id: "046-b",
      meta: { title: "046", participants: ["curator", "dev-core"], status: "open" },
      messages: [announcement],
    };
    expect([...parkedThreads([thread("042-a", "pr:133"), elsewhere])]).toEqual([]);
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
    expect(parkedOnKind("run:12x").kind).toBe("person");
    expect(parkedOnKind("runner").kind).toBe("person");
  });

  it("reads a round (thread 019) — the same PR number, the other thing waited for", () => {
    expect(parkedOnKind("run:163")).toEqual({ kind: "run", pr: 163 });
  });
});

describe("parkingOf — the facts the courier to the human needs (thread 023)", () => {
  const thread = (text: string, expects: "answer" | "ack" | "none" = "answer"): Thread => ({
    id: "023-x",
    meta: { title: "t", participants: ["curator", "john"], status: "open" },
    messages: [
      {
        fields: {
          from: "curator",
          date: "2026-07-31T11:08:20Z",
          expects,
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
      asks: true,
    });
  });

  it("carries WHETHER THE MESSAGE ASKS ANYTHING — the freeze is the same, the call is not", () => {
    // Thread 051: a park declared by an informational message is still a park (the turn cannot
    // move, the scheduler skips the thread), but nobody is being called — the message says so
    // itself. The door refuses this combination today; the feed предшествует двери.
    expect(parkingOf(thread("фиксация мыслей, НЕ в работу", "none"))?.asks).toBe(false);
    expect(parkingOf(thread("Чинить ли гард 2?"))?.asks).toBe(true);
  });

  it("`ack` CALLS TOO — the door leaves exactly two legal parks, and both need the person", () => {
    // Curator's decision of 2026-08-03: the door refuses `--parked-on` with `--expects none`
    // (034), so a park is either `answer` or `ack`; `ack` is "I stand until you confirm", which
    // is an action of the human just the same. Ringing only on `answer` would let a thread
    // freeze with NOBODY told — the age pass is quiet about parks, the scheduler skips them.
    expect(parkingOf(thread("подтверди, что снёс лок", "ack"))?.asks).toBe(true);
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
  // The trace class of the circuit: it asks nobody for anything AND names no holder of the
  // turn — the two things the narrow lift reads (023). `waiting-on` is left OUT, exactly as
  // `ci-outcome.yml` leaves it out on `success`/`cancelled`.
  const announcement = (fields: Partial<Message["fields"]>, text: string): Message => ({
    fields: {
      from: "github",
      worker: "gh-action",
      date: "2026-07-31T12:30:00Z",
      expects: "none",
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
      asks: true,
    });
  });

  it("THE MERGE IT WAITS FOR lifts it, though the announcement is informational", () => {
    const parked = message({ parkedOn: "pr:127" });
    const merged = announcement({ mergedPr: 127 }, "PR #127 merged");
    expect(parkingOf(thread([parked, merged]))).toBeUndefined();
  });

  it("somebody else's merge does NOT lift it — the lift is narrow, as the round's is (023)", () => {
    // The wide lift was the whole shape of this park until 2026-08-03, and curator's statement
    // of that morning narrowed it to the round's: an announcement about ANOTHER PR is not the
    // button being pressed, and the raise it bought read four files and parked again.
    const parked = message({ parkedOn: "pr:127" });
    const merged = announcement({ mergedPr: 129 }, "PR #129 merged");
    expect(parkingOf(thread([parked, merged]))?.pr).toBe(127);
  });

  it("an outcome of the circuit does not lift it either — it asks nobody for anything", () => {
    const parked = message({ parkedOn: "pr:127" });
    const ci = announcement({}, "✅ CI по PR #131: `success`.");
    expect(parkingOf(thread([parked, ci]))?.kind).toBe("event");
  });

  it("a message that ASKS lifts it — the answer arriving is the answer arriving", () => {
    const parked = message({ parkedOn: "pr:127" });
    const asked = message({ from: "curator", date: "2026-07-31T12:40:00Z", expects: "answer" });
    expect(parkingOf(thread([parked, asked]))).toBeUndefined();
  });

  it("an ACTIONABLE outcome lifts it — it hands the turn over without asking (048)", () => {
    const parked = message({ parkedOn: "pr:127" });
    const red = announcement(
      { waitingOn: "dev-core", date: "2026-07-31T12:40:00Z" },
      "❌ CI по PR #127: `failure`.",
    );
    expect(parkingOf(thread([parked, red]))).toBeUndefined();
  });

  it("an announcement BEFORE the park does not lift it — a park is a later statement", () => {
    const merged = announcement({ date: "2026-07-31T11:00:00Z", mergedPr: 127 }, "PR #127 merged");
    const parked = message({ parkedOn: "pr:127" });
    expect(parkingOf(thread([merged, parked]))?.kind).toBe("event");
  });

  it("parkedOnOf keeps the raw value, so the skip line can tell the two apart", () => {
    expect(parkedOnOf(thread([message({ parkedOn: "pr:127" })]))).toBe("pr:127");
  });

  it("A MERGE ANNOUNCED IN ANOTHER THREAD lifts it — the notifier writes into the PR's own", () => {
    // The live case (042 parked on `pr:133`, the announcement of 133 delivered to 046): the
    // park would otherwise outlive the merge it waits for, in the one thread that cannot see it.
    const parked = thread([message({ parkedOn: "pr:133" })]);
    expect(parkingOf(parked, new Set([133]))).toBeUndefined();
    expect(parkedOnOf(parked, new Set([133]))).toBeUndefined();
  });

  it("somebody else's merge elsewhere still lifts nothing", () => {
    expect(parkingOf(thread([message({ parkedOn: "pr:133" })]), new Set([129]))?.pr).toBe(133);
  });

  it("a caller with one thread reads what that thread saw — the set is optional", () => {
    expect(parkingOf(thread([message({ parkedOn: "pr:133" })]))?.pr).toBe(133);
  });
});

describe("parkingOf — a park on the ROUND running on a PR (thread 019)", () => {
  const message = (fields: Partial<Message["fields"]>, text = "тело"): Message => ({
    fields: {
      from: "curator",
      date: "2026-08-02T09:12:57Z",
      expects: "answer",
      waitingOn: "curator",
      ...fields,
    } as Message["fields"],
    text,
  });
  const announcement = (fields: Partial<Message["fields"]>, text: string): Message => ({
    fields: {
      from: "github",
      worker: "gh-action",
      date: "2026-08-02T09:15:07Z",
      expects: "none",
      ...fields,
    } as Message["fields"],
    text,
  });
  const thread = (messages: readonly Message[]): Thread => ({
    id: "019-operator-ux",
    meta: { title: "t", participants: ["curator", "dev-core"], status: "open" },
    messages,
  });

  it("names the PR whose ROUND is waited for — a verdict, not a button", () => {
    expect(parkingOf(thread([message({ parkedOn: "run:163" }, "Жду вердикта по #163.")]))).toEqual({
      kind: "run",
      pr: 163,
      since: "2026-08-02T09:12:57Z",
      question: "Жду вердикта по #163.",
      asks: true,
    });
  });

  it("THE LIVE CASE: the CI announcement does NOT lift it — it is not the verdict", () => {
    // 09:12:57Z parked, 09:15:07Z "CI по PR #163 — success", 09:16:13Z the pair raised into a
    // review round with twelve minutes still to run. That raise is the whole reason for the form.
    const parked = message({ parkedOn: "run:163" });
    const ci = announcement({ date: "2026-08-02T09:15:07Z" }, "CI по PR #163: success");
    expect(parkingOf(thread([parked, ci]))?.kind).toBe("run");
    expect(parkedOnOf(thread([parked, ci]))).toBe("run:163");
  });

  it("several announcements in a row do not lift it either", () => {
    const parked = message({ parkedOn: "run:163" });
    expect(
      parkingOf(
        thread([
          parked,
          announcement({ date: "2026-08-02T09:15:07Z" }, "CI: success"),
          announcement({ date: "2026-08-02T09:16:07Z" }, "смоук: success"),
        ]),
      )?.pr,
    ).toBe(163);
  });

  it("the verdict lifts it — a message that asks somebody for something", () => {
    const parked = message({ parkedOn: "run:163" });
    const ci = announcement({ date: "2026-08-02T09:15:07Z" }, "CI: success");
    const verdict = message(
      { from: "reviewer-pr", date: "2026-08-02T09:20:00Z", expects: "answer" },
      "verdict: approve",
    );
    expect(parkingOf(thread([parked, ci, verdict]))).toBeUndefined();
  });

  it("the merge of THAT PR lifts it, wherever it was announced — the round cannot end twice", () => {
    const parked = message({ parkedOn: "run:163" });
    expect(parkingOf(thread([parked]), new Set([163]))).toBeUndefined();
    const merged = announcement({ date: "2026-08-02T09:30:00Z", mergedPr: 163 }, "PR #163 merged");
    expect(parkingOf(thread([parked, merged]))).toBeUndefined();
  });

  it("somebody else's merge announced afterwards lifts nothing", () => {
    const parked = message({ parkedOn: "run:163" });
    const merged = announcement({ date: "2026-08-02T09:30:00Z", mergedPr: 149 }, "PR #149 merged");
    expect(parkingOf(thread([parked, merged]))?.pr).toBe(163);
    expect(parkingOf(thread([parked]), new Set([149]))?.pr).toBe(163);
  });

  it("a park declared AFTER the announcements is the newest statement and stands", () => {
    const ci = announcement({ date: "2026-08-02T09:10:00Z" }, "CI: success");
    const parked = message({ parkedOn: "run:163" });
    expect(parkingOf(thread([ci, parked]))?.kind).toBe("run");
  });

  it("THE LIVE INCIDENT OF 023: an ACTIONABLE outcome DOES lift it (2026-08-03)", () => {
    // The `failure` of #177 was delivered at 06:23:44Z into a thread parked on `run:177`; the
    // park did not lift, the pair stood dead for 3.5 hours with an actionable red in front of
    // it, and a human noticed the silence. The notifier names the role on the actionable class
    // (048, form (б)) and leaves the field out on the trace class — which is where this reads.
    const parked = message({ parkedOn: "run:177", date: "2026-08-03T06:15:46Z" });
    const red = announcement(
      { date: "2026-08-03T06:23:44Z", waitingOn: "dev-core" },
      "❌ CI по PR #177: `failure`.",
    );
    expect(parkingOf(thread([parked, red]))).toBeUndefined();
  });

  it("a GREEN trace still lifts nothing — that is the case the narrow form was built for", () => {
    const parked = message({ parkedOn: "run:177", date: "2026-08-03T06:15:46Z" });
    const green = announcement({ date: "2026-08-03T06:23:44Z" }, "✅ CI по PR #177: `success`.");
    expect(parkingOf(thread([parked, green]))?.pr).toBe(177);
  });

  it("THE SECOND LIVE INCIDENT OF 023: a GREEN outcome CARRYING THE TURN lifts it (2026-08-03)", () => {
    // The lift is read from ONE FACT — does the message move anybody — and never from a list of
    // conclusions, which is what makes this case need no second rule. It is the same predicate
    // the red of #177 above goes through; the only thing that changed under it is the notifier,
    // which since #187 names the author's role on a GREEN `checks` of a PR with no `review`
    // label (048, form (б)): the turn is the one action of hanging the label.
    //
    // Live, and the reason this test exists: 11:51:59Z parked on `run:188`, 11:59:46Z the green
    // arrived carrying `waiting-on: dev-core`, and the pair still stood — for over an hour, to
    // a human's eye and not the circuit's. The park was NOT the cause, and the test says so by
    // construction: this is the very state of that feed, and it lifts.
    const parked = message({ parkedOn: "run:188", date: "2026-08-03T11:51:59Z" });
    const green = announcement(
      { date: "2026-08-03T11:59:46Z", waitingOn: "dev-core" },
      "✅ CI по PR #188: `success`. Метка `review` не повешена — ход у автора.",
    );
    expect(parkingOf(thread([parked, green]))).toBeUndefined();
  });

  it("a DECLARED NULL is not a handover — it moves the turn to nobody", () => {
    const parked = message({ parkedOn: "run:163" });
    const nulled = announcement({ date: "2026-08-02T09:15:07Z", waitingOn: null }, "CI: success");
    expect(parkingOf(thread([parked, nulled]))?.pr).toBe(163);
  });

  it("a person park behind the announcements keeps its WIDE lift — 023 is untouched", () => {
    // The two parks wait for different things: the wide lift is the safety against a thread
    // frozen behind a human forever, and it fired correctly the same morning (08:41 → 08:44).
    const parked = message({ parkedOn: "john" });
    const ci = announcement({ date: "2026-08-02T09:15:07Z" }, "CI: success");
    expect(parkingOf(thread([parked, ci]))).toBeUndefined();
  });

  it("a `pr:` park behind the announcements now STANDS — both event parks read one walk", () => {
    const merge = message({ parkedOn: "pr:163" });
    const ci = announcement({ date: "2026-08-02T09:15:07Z" }, "CI: success");
    expect(parkingOf(thread([merge, ci]))?.kind).toBe("event");
  });

  it("closed outranks it, as it outranks every other park", () => {
    const parked = thread([message({ parkedOn: "run:163" })]);
    expect(parkingOf({ ...parked, meta: { ...parked.meta, status: "closed" } })).toBeUndefined();
  });
});

describe("mergedPrs — the merges the whole mail has seen (thread 023)", () => {
  const thread = (id: string, messages: readonly Message[]): Thread => ({
    id,
    meta: { title: id, participants: ["curator", "dev-core"], status: "open" },
    messages,
  });
  const announcement = (pr: number): Message => ({
    fields: {
      from: "github",
      date: "2026-07-31T12:30:00Z",
      expects: "none",
      worker: "gh-action",
      mergedPr: pr,
    } as Message["fields"],
    text: `PR #${pr} merged`,
  });
  const plain: Message = {
    fields: {
      from: "curator",
      date: "2026-07-31T12:00:00Z",
      expects: "answer",
      waitingOn: "dev-core",
    } as Message["fields"],
    text: "тело",
  };

  it("collects every announced merge, whichever thread it landed in", () => {
    const merged = mergedPrs([
      thread("023-a", [plain, announcement(133)]),
      thread("046-b", [announcement(129)]),
      thread("040-c", [plain]),
    ]);
    expect([...merged].sort((a, b) => a - b)).toEqual([129, 133]);
  });

  it("empty mail knows no merges — and lifts nothing", () => {
    expect(mergedPrs([]).size).toBe(0);
  });
});
