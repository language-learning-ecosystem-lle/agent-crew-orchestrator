import { describe, expect, it } from "vitest";

import { renderIndex, threadsWaitingOn } from "./index-doc.js";
import { migrateLegacyThread, verifyMigration } from "./migrate.js";
import {
  declaredWaitingOn,
  parseLegacyThread,
  parseMetaFile,
  renderMetaFile,
  renderThread,
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
    expect(thread.messages[1]?.fields.waitingOn).toEqual(["john", "curator"]);
  });

  it("fails on a non-standard header instead of guessing it", () => {
    expect(() => parseLegacyThread("012-x", "# title only\n", ROLES)).toThrow(/header/);
  });
});

describe("declaredWaitingOn", () => {
  it("counts only an arrow immediately after the word as a declaration", () => {
    expect(declaredWaitingOn("waiting-on stays with john", ROLES)).toBeUndefined();
    expect(declaredWaitingOn("waiting-on → john", ROLES)).toEqual(["john"]);
  });

  it("takes the last declaration, not the first", () => {
    const text = "waiting-on → john\n\nthen we changed our minds\n\nwaiting-on → curator";

    expect(declaredWaitingOn(text, ROLES)).toEqual(["curator"]);
  });

  it("does not lose a role because of a parenthesised explanation", () => {
    // Thread 011: the hypothesis "parentheses eat the next role" was checked by fact.
    expect(declaredWaitingOn("waiting-on → dev-speech (stage 1), john (VPS)", ROLES)).toEqual([
      "dev-speech",
      "john",
    ]);
  });

  it("cuts at the last waiting-on word, not at the first arrow in the line", () => {
    // The arrow is a common character in prose (@BotFather → chat_id → chmod 600).
    const text = "setup: @BotFather → token → chmod 600. waiting-on → john";

    expect(declaredWaitingOn(text, ROLES)).toEqual(["john"]);
  });

  it("a declaration without known roles yields an empty set, not the absence of a declaration", () => {
    expect(declaredWaitingOn("waiting-on → —", ROLES)).toEqual([]);
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

    expect(waitingOnOf(withNote)).toEqual(["john", "curator"]);
  });

  it("a closed thread awaits nobody, whatever the last section says", () => {
    const thread = parseLegacyThread(
      "012-x",
      LEGACY.replace("status: open", "status: closed"),
      ROLES,
    );

    expect(waitingOnOf(thread)).toEqual([]);
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
| 012-x | curator, dev-core, john | open | john, curator | 2026-07-23 |
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
