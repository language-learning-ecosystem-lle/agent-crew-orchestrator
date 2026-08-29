import { describe, expect, it } from "vitest";

import { closedThreads, parkedThreads, renderIndex, threadsWaitingOn } from "./index-doc.js";
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
  personParksOf,
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

  // THE DECLARED FORM (thread 079) survives the round trip — and its ABSENCE is an
  // absent line, not an empty value: every head written before the key existed has to
  // render back byte for byte, which is the whole reason the key is optional.
  it("'turn: explicit' is parsed and rendered back; a head without it keeps no line", () => {
    const thread = parseLegacyThread("012-x", LEGACY, ROLES);
    const declared = { ...thread.meta, turn: "explicit" as const };

    const raw = renderMetaFile(declared);

    expect(raw).toContain("turn: explicit\n");
    expect(parseMetaFile(raw)).toEqual(declared);
    expect(renderMetaFile(thread.meta)).not.toContain("turn:");
    expect(parseMetaFile(renderMetaFile(thread.meta)).turn).toBeUndefined();
  });

  it("a 'turn' the key does not know is refused, naming the one value there is", () => {
    const raw = renderMetaFile({ title: "t", participants: ["curator"], status: "open" }).replace(
      "status: open\n",
      "status: open\nturn: strict\n",
    );

    expect(() => parseMetaFile(raw)).toThrow(/explicit/);
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

  // THE CLOSURES AS A SET (thread 016) — the fact the journal does not carry, for the one
  // reader that folds the journal and has no other way of learning it.
  it("closedThreads names the closed threads and only those", () => {
    const open = parseLegacyThread("012-x", LEGACY, ROLES);
    const closed = parseLegacyThread(
      "001-y",
      LEGACY.replace("status: open", "status: closed"),
      ROLES,
    );

    expect([...closedThreads([closed, open])]).toEqual(["001-y"]);
    expect([...closedThreads([open])]).toEqual([]);
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

  it("A COUNTER-REPORT OF A ROLE LEAVES IT STANDING — the narrow lift of 2026-08-22", () => {
    // Thread 030, defect (в1), decision of john: the park on a person lifts on the word of that
    // person and on nothing else. An ordinary message with a turn in it — which is what this is
    // — used to lift it, and that is the class the park was set against: the answer had not come.
    expect(parkedOnOf(parked({}))).toBe("john");
  });

  it("'delivers: john' LIFTS IT — the word of the person, carried by whoever relays it", () => {
    // The one lift, and it is a declaration of the courier: a person does not write into the
    // mail, and no other header field says whether their answer has arrived.
    expect(parkedOnOf(parked({ from: "curator", delivers: "john" }))).toBeUndefined();
  });

  it("'delivers: <ANOTHER person>' does not lift it — the delivery names one person", () => {
    expect(parkedOnOf(parked({ from: "curator", delivers: "maria" }))).toBe("john");
  });

  it("a delivery lifts it from BEHIND later traffic — the walk remembers, it does not stop", () => {
    // The courier says the word and hands the turn on; the roles then work in the thread. The
    // park is lifted by the message that carried the word, not re-frozen by the ones after it.
    const thread = parked({ from: "curator", delivers: "john", waitingOn: "dev-core" });
    const after: Message = {
      fields: { from: "dev-core", date: "2026-07-30T03:00:00Z", expects: "ack" },
      text: "сделано",
    };
    expect(parkedOnOf({ ...thread, messages: [...thread.messages, after] })).toBeUndefined();
  });

  it("a delivery BEFORE the park lifts nothing — it answered the question that came first", () => {
    // The stamps order the feed: a park declared after the word was delivered is a new question.
    const thread: Thread = {
      id: "030-x",
      meta: { title: "t", participants: ["curator", "john"], status: "open" },
      messages: [
        {
          fields: {
            from: "curator",
            date: "2026-07-30T01:00:00Z",
            expects: "none",
            delivers: "john",
          },
          text: "слово john по прошлому вопросу",
        },
        {
          fields: {
            from: "curator",
            date: "2026-07-30T02:00:00Z",
            expects: "answer",
            parkedOn: "john",
          },
          text: "новый вопрос",
        },
      ],
    };
    expect(parkedOnOf(thread)).toBe("john");
  });

  it("THE MERGE NOTIFIER OF #192 DOES NOT LIFT IT — the repro the narrow lift was bought with", () => {
    // 2026-08-03, thread 023: the park stood on john, and it was thawed by the notifier of the
    // merge of #192 ('from: github', 'expects: none', no 'waiting-on') — announcing a merge
    // curator had pressed herself three minutes earlier. Price, measured: one empty curator
    // session and a gap of THREE SECONDS to the `restart` button that raise then held up
    // ('agent-comms/023-daemon-parallelism/messages/2026-08-03T19-57-08Z-curator.md' §1).
    // Decision of john 2026-08-04: the same predicate as the event parks.
    const thread = parked({ from: "github", worker: "gh-action", expects: "none" });
    expect(parkedOnOf(thread)).toBe("john");
  });

  it("A MUDDY DELIVERY DOES NOT LIFT IT EITHER — it asks nobody and hands the turn to nobody", () => {
    // Deliberate, and named as such in curator's statement: such a message has nothing for a
    // raised pair to do, and the thaw costs one more message from the same courier.
    const thread = parked({ from: "curator", worker: "claude-ai", expects: "none" });
    expect(parkedOnOf(thread)).toBe("john");
  });

  it("A DECLARED NULL DOES NOT LIFT IT — zeroing the holder is not a handover", () => {
    const thread = parked({
      from: "github",
      worker: "gh-action",
      expects: "none",
      waitingOn: null,
    });
    expect(parkedOnOf(thread)).toBe("john");
  });

  it("A MESSAGE THAT ASKS DOES NOT LIFT IT ANY MORE — asking is not answering (030)", () => {
    // It did until 2026-08-22, on the reading that a courier of a decision asks or hands the
    // turn over by construction. True of the courier, and true of everybody ELSE with a turn
    // too — which is why the park now waits for the courier to SAY that it is a delivery.
    const thread = parked({ from: "github", worker: "gh-action", expects: "answer" });
    expect(parkedOnOf(thread)).toBe("john");
  });

  it("THE COURIER OF A DECISION LIFTS IT — and now by the field, not by the shape of its header", () => {
    // Thread 023, live repros (040, 044, 016): curator relaying john's decision and handing the
    // turn on writes 'expects: none'. The delivery is the same message it always was; since
    // 2026-08-22 it carries the fact in a field a reader can trust.
    const thread = parked({
      from: "curator",
      worker: "claude-ai",
      expects: "none",
      waitingOn: "dev-core",
      delivers: "john",
    });
    expect(parkedOnOf(thread)).toBeUndefined();
  });

  it("THE SAME LETTER WITHOUT THE FIELD leaves it standing — and the digest is what says so", () => {
    // The price of the narrowing, named rather than hidden: a courier who forgets '--delivers'
    // leaves a park standing, and the human reads it in the NEXT digest ('N parked, K of them
    // asking' — thread 030) instead of half a day later, which is what the wide lift cost.
    expect(parkedOnOf(parked({ from: "curator", worker: "claude-ai" }))).toBe("john");
  });

  it("a park DECLARED ON an informational message acts — the field is read before the skip", () => {
    // Thread 034, paid for twice with empty sessions: 'expects: none' used to be skipped
    // before the field was looked at, so this park was invisible and the pair was raised
    // into a thread waiting for a human. The door refused the combination from 034 until
    // 2026-08-04 and passes it again since (park as a MODE); either way it acts here.
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

describe("parkedOnOf — a park on a person is a park ON A TURN (thread 042)", () => {
  // The fixtures are built from REAL headers, and all of them from the two days the norm was
  // measured on: the LLE feed of 2026-08-28 named in `PROTOCOL.md` message by message, and this
  // circuit's own thread `042-unaccepted-turn-silent` of 2026-08-29.
  const message = (
    date: string,
    fields: Partial<Message["fields"]> & { from: string },
    text = "…",
  ): Message => ({
    fields: { expects: "answer", date, ...fields },
    text,
  });
  const thread = (...messages: readonly Message[]): Thread => ({
    id: "010-speech-service",
    meta: { title: "t", participants: ["curator", "dev-speech", "github", "john"], status: "open" },
    messages: [...messages],
  });
  // `12-11-29Z-curator.md`: the park declared ON CURATOR'S OWN TURN — the header the whole norm
  // is read from (`parked-on: john`, `waiting-on: curator`).
  const declared = message("2026-08-28T12:11:29Z", {
    from: "curator",
    parkedOn: "john",
    waitingOn: "curator",
  });

  it("THE 4 h 16 m OF LLE: the turn moved to another role, so the park covers nobody", () => {
    // 2026-08-28, the case the norm was written on. Two letters after the park the turn stood on
    // `dev-speech`, a role waiting for nothing from john — and the daemon printed
    // `⏸ PARKED behind a decision of john (R27)` 201 times, a true sentence about the thread and
    // a false one about the pair. Between `lease-released 12:13:54Z` and `lease-acquired
    // 16:29:49Z` the journal has not one line.
    const feed = thread(
      declared,
      message("2026-08-28T12:13:16Z", { from: "dev-speech", waitingOn: "curator" }),
      message("2026-08-28T12:14:09Z", { from: "github", expects: "none", waitingOn: "dev-speech" }),
    );
    expect(parkedOnOf(feed)).toBeUndefined();
  });

  it("AT THE SAME HOLDER A ROLE'S OWN REPORT LEAVES IT STANDING — the narrowing of 22.08 kept", () => {
    // `042`, 2026-08-29: the park of `03-27-44Z-curator.md` (`expects: ack`, `waiting-on:
    // curator`) and dev-core's report of `03-36-47Z` (`expects: answer`, `waiting-on: curator`)
    // — the turn never left curator, and a report is not an answer from john. This is defect
    // (в1) of thread 030, and it is exactly what the new lift must not undo.
    const feed = thread(
      declared,
      message("2026-08-29T03:36:47Z", { from: "dev-core", waitingOn: "curator" }),
    );
    expect(parkedOnOf(feed)).toBe("john");
  });

  it("AT THE SAME HOLDER AN ACTIONABLE OUTCOME OPENS A NEW TURN — red CI, green `checks`", () => {
    // The second half of the norm, and the header carries the whole judgement already: the
    // notifier names the role on `failure`/`timed_out`/… and on a green `checks` over a PR
    // without the `review` label, and stays silent (no `waiting-on`) on the trace class. So an
    // outcome is "the turn is handed over WITHOUT a question in it", which no report ever is.
    const feed = thread(
      declared,
      message("2026-08-28T12:20:00Z", { from: "github", expects: "none", waitingOn: "curator" }),
    );
    expect(parkedOnOf(feed)).toBeUndefined();
  });

  it("THE TRACE OF THE CIRCUIT OPENS NOTHING — it hands the turn to nobody", () => {
    // The `success` echo and the merge notifier: `expects: none` and no `waiting-on` at all.
    // This is the class the narrowing of 22.08 was bought for (the notifier of #192, thread
    // 023), and it stays outside both lifts.
    const feed = thread(
      declared,
      message("2026-08-28T12:20:00Z", { from: "github", expects: "none", mergedPr: 192 }),
    );
    expect(parkedOnOf(feed)).toBe("john");
  });

  it("A DECLARED NULL AFTER THE PARK OPENS NOTHING — it moves the thread to nobody", () => {
    const feed = thread(
      declared,
      message("2026-08-28T12:20:00Z", { from: "github", expects: "none", waitingOn: null }),
    );
    expect(parkedOnOf(feed)).toBe("john");
  });

  it("THE TURN COMING BACK DOES NOT REVIVE IT — the third turn is not the parked one", () => {
    // A park is declared on ONE turn. Once the turn has gone to somebody else that turn is over,
    // and a later handover back to the same role starts a new one, which inherits no freeze.
    const feed = thread(
      declared,
      message("2026-08-28T12:13:16Z", { from: "curator", waitingOn: "dev-speech" }),
      message("2026-08-28T12:30:00Z", { from: "dev-speech", waitingOn: "curator" }),
    );
    expect(parkedOnOf(feed)).toBeUndefined();
  });

  it("'delivers' STILL LIFTS IT WHOLE — the word of the person outranks whose turn it is", () => {
    const feed = thread(
      declared,
      message("2026-08-28T12:13:16Z", { from: "curator", waitingOn: "dev-speech" }),
      message("2026-08-28T12:30:00Z", {
        from: "curator",
        expects: "none",
        delivers: "john",
        waitingOn: "dev-speech",
      }),
    );
    expect(parkedOnOf(feed)).toBeUndefined();
  });

  it("A PARK THAT NAMED NO TURN KEEPS THE WHOLE THREAD — the MODE parks of 016 and 052", () => {
    // THE REGRESSION WITHOUT WHICH THIS CHANGE MUST NOT BE TAKEN: ten parks stand in the field
    // today, the oldest eleven days old, and the ones declared without `waiting-on` say nothing
    // about whose turn they were set on. Guessing would turn every one of them into a raise on
    // the day this ships, so they behave exactly as they did before 042.
    const feed = thread(
      message("2026-08-28T12:11:29Z", { from: "curator", expects: "none", parkedOn: "john" }),
      message("2026-08-28T12:13:16Z", { from: "dev-speech", waitingOn: "curator" }),
      message("2026-08-28T12:14:09Z", { from: "github", expects: "none", waitingOn: "dev-speech" }),
    );
    expect(parkedOnOf(feed)).toBe("john");
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
      // WHOSE TURN IT WAS DECLARED ON (thread 042) — the half a park was missing until the
      // four windows of 2026-08-28: the park is written on the thread and the turn moves on,
      // so without this the pair that inherited it is indistinguishable from the one it is about.
      holder: "curator",
    });
  });

  it("carries WHETHER THE MESSAGE ASKS ANYTHING — the freeze is the same, the call is not", () => {
    // Thread 051: a park declared by an informational message is still a park (the turn cannot
    // move, the scheduler skips the thread), but nobody is being called — the message says so
    // itself. Legal at the door again since 2026-08-04 — the park as a MODE (023).
    expect(parkingOf(thread("фиксация мыслей, НЕ в работу", "none"))?.asks).toBe(false);
    expect(parkingOf(thread("Чинить ли гард 2?"))?.asks).toBe(true);
  });

  it("`ack` CALLS TOO — the line is `none`, and everything else needs the person", () => {
    // Curator's decision of 2026-08-03: `ack` is "I stand until you confirm", which is an
    // action of the human just the same. Ringing only on `answer` would let a thread freeze
    // with NOBODY told — the age pass is quiet about parks, the scheduler skips them.
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

describe("personParksOf — the declarations a LIFTED park leaves behind (thread 030, (в2))", () => {
  const at = (date: string, fields: Partial<Message["fields"]> = {}, text = "Чинить?"): Message =>
    ({
      fields: { from: "curator", date, expects: "answer", waitingOn: "curator", ...fields },
      text,
    }) as Message;
  const thread = (messages: readonly Message[], status: "open" | "closed" = "open"): Thread => ({
    id: "030-x",
    meta: { title: "t", participants: ["curator", "john"], status },
    messages,
  });

  it("reads EVERY person-park of the feed, the lifted ones included — parkingOf reads one", () => {
    // The courier's second question: a park it announced has vanished from the composition,
    // and what it was asking lives only in the message that declared it — behind the walk of
    // `standingParkOf`, which stopped at the message that lifted it.
    const feed = thread([
      at("2026-08-22T17:44:22Z", { parkedOn: "john" }, "# Сузить ли снятие парковки?"),
      at("2026-08-22T18:10:30Z", { from: "github", waitingOn: "dev-core" }, "PR #61 merged"),
      at("2026-08-22T18:30:00Z", { parkedOn: "john" }, "Вопрос (в) ставится заново"),
    ]);

    expect(personParksOf(feed)).toEqual([
      {
        kind: "person",
        person: "john",
        since: "2026-08-22T17:44:22Z",
        question: "Сузить ли снятие парковки?",
        asks: true,
      },
      {
        kind: "person",
        person: "john",
        since: "2026-08-22T18:30:00Z",
        question: "Вопрос (в) ставится заново",
        asks: true,
      },
    ]);
    // And the standing one is still exactly what `parkingOf` says it is — the two readers do
    // not disagree about the park in force, they answer different questions.
    expect(parkingOf(feed)?.since).toBe("2026-08-22T18:30:00Z");
  });

  it("carries `asks` — a park declared as a MODE asked nothing, so its lift owes nothing", () => {
    expect(
      personParksOf(thread([at("2026-08-22T17:44:22Z", { parkedOn: "john", expects: "none" })])),
    ).toEqual([
      {
        kind: "person",
        person: "john",
        since: "2026-08-22T17:44:22Z",
        question: "Чинить?",
        asks: false,
      },
    ]);
  });

  it("an EVENT park is not a person park — nobody is being waited for by name", () => {
    expect(personParksOf(thread([at("2026-08-22T17:44:22Z", { parkedOn: "pr:63" })]))).toEqual([]);
    expect(personParksOf(thread([at("2026-08-22T17:44:22Z", { parkedOn: "run:63" })]))).toEqual([]);
  });

  it("a CLOSED thread declares nothing — closing the thread IS the answer", () => {
    const feed = thread([at("2026-08-22T17:44:22Z", { parkedOn: "john" })], "closed");

    expect(personParksOf(feed)).toEqual([]);
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

  // THE RACE OF THE PARK WRITTEN BEHIND ITS OWN CONDITION (thread 032, 2026-08-23). This read
  // "an announcement BEFORE the park does not lift it — a park is a later statement" until that
  // day, and the reading disagreed with the mail-wide one beside it: `mergedPrs` compares no
  // dates (023), and a whole-mail caller — every production reader is one — passes it a set
  // that already contains this thread's own announcement, so the park did not stand for THEM
  // and did stand for a caller holding the single thread. One question, two answers. The
  // window between the state a session reads and the commit of the letter it writes from that
  // state is minutes wide and closes for nobody, so the answer kept is the one that does not
  // freeze a pair behind an event that has already happened.
  it("an announcement BEFORE the park lifts it too — the same answer as the mail-wide read", () => {
    const merged = announcement({ date: "2026-07-31T11:00:00Z", mergedPr: 127 }, "PR #127 merged");
    const parked = message({ parkedOn: "pr:127" });
    expect(parkingOf(thread([merged, parked]))).toBeUndefined();
  });

  it("and the regression: a merge announced AFTER the park behaves exactly as before", () => {
    const parked = message({ parkedOn: "pr:127" });
    const merged = announcement({ date: "2026-07-31T12:40:00Z", mergedPr: 127 }, "PR #127 merged");
    expect(parkingOf(thread([parked, merged]))).toBeUndefined();
    // …and somebody else's merge, before or after, is still not this park's condition.
    const other = announcement({ date: "2026-07-31T11:00:00Z", mergedPr: 129 }, "PR #129 merged");
    expect(parkingOf(thread([other, parked]))?.pr).toBe(127);
  });

  it("parkedOnOf keeps the raw value, so the skip line can tell the two apart", () => {
    expect(parkedOnOf(thread([message({ parkedOn: "pr:127" })]))).toBe("pr:127");
  });

  it("A DELIVERY DOES NOT LIFT AN EVENT PARK — the narrowing of 030 touched the person park only", () => {
    // The norm says it in as many words: the event parks wait for a machine event, and their
    // wide walk is left exactly as it was. A word of a human is not the button being pressed.
    const parked = message({ parkedOn: "pr:127" });
    const word = announcement({ delivers: "john", date: "2026-07-31T12:40:00Z" }, "john сказал");
    expect(parkingOf(thread([parked, word]))?.pr).toBe(127);
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

  it("a person park behind the announcements STANDS TOO — one walk for all three (2026-08-04)", () => {
    // This test used to assert the opposite, and it named the wide lift the safety against a
    // thread frozen behind a human forever. On 2026-08-03 that safety fired at its own circuit
    // (the merge notifier of #192 thawed a park on john, for an empty session), and john's
    // decision of 2026-08-04 gave all three kinds one criterion of lifting.
    const parked = message({ parkedOn: "john" });
    const ci = announcement({ date: "2026-08-02T09:15:07Z" }, "CI: success");
    expect(parkingOf(thread([parked, ci]))?.kind).toBe("person");
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
