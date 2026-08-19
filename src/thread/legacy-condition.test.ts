/**
 * A CONDITION OF THIS REPOSITORY IS NEVER WRITTEN AS THE THREAD NUMBERS OF ANOTHER MAIL.
 * A claim about this repository's own normative texts, held in the generic package for
 * the reason `workflow-signatures.test.ts` holds its own: the repository serves itself.
 *
 * THE DEFECT IT PINS (thread `014-merge-model`, measured 2026-08-19). The rule "a legacy
 * thread is appended to by hand until it is migrated" carried its scope as a LIST OF
 * NUMBERS — «сейчас это только 009/010» — inherited from the parent mail this package was
 * forked out of. Five copies of one criterion said it: `PROTOCOL.md` (the norm, twice),
 * `packages/agent-protocol/README.md` (the only description of command form in this
 * repository), `.github/workflows/ci-outcome.yml` (an executable comment) and
 * `thread/thread.ts` (this directory). The cost is not inelegance: `009` and `010` EXIST
 * in this mail as `009-install-notes` and `010-zones-check-writes`, both migrated, so a
 * reader checking the condition here gets a WRONG answer rather than an empty one — and
 * `thread.ts` stated it as a fact about the code ("the threads this path reads are frozen
 * history"), which in this mail is simply false. #33 (`932ed2a`) landed the shape that
 * replaces it: the condition is a command the reader runs in their OWN checkout —
 * `for d in agent-comms/[0-9][0-9][0-9]-*; do [ -d "$d/messages" ] || echo "$d"; done`.
 *
 * WHAT THIS TEST IS AND IS NOT, named rather than implied. It bans the literal legacy
 * enumeration in the four files that carry the NORM. It does NOT ban the form in general
 * — that was tried and measured fragile: a sweep for `\d{3}/\d{3}` hits eight legitimate
 * lines (`cli.ts:3192`, `:3208`, `lease.ts:186`, `message.ts:239`, `migrate.ts:120`,
 * `write.ts:6`, `write.test.ts:59` and `PROTOCOL.md:132` itself), all of them ordinary
 * REFERENCES to a parent thread, which `docs/install-notes.md` §4 declares not to be
 * rewritten. Passing that would need a line-level allow-list, i.e. a test that breaks on
 * every edit of the prose around it. So the guard is scoped by FILE and by the one string
 * that formulated the condition, and what it buys is exact: the five sites cannot come
 * back quietly. A condition dressed in some OTHER pair of foreign numbers is not caught
 * here — that is a reviewer's judgement (statement of work §3в), and it is stated here so
 * nobody reads a green run as more than it is.
 *
 * OUT OF SCOPE ON PURPOSE, each with its reason — these files keep the literal and are
 * right to: `docs/protocol-reference.md` (:240, :292) and `orchestrator/home.ts` (:13-14)
 * record DATED MEASUREMENTS, true as history and binding nobody; `.github/workflows/
 * merge-notify.yml` marks its four occurrences as the PARENT mail's (#33), which is the
 * fix, not the defect.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = new URL("../../../../", import.meta.url);

/** The string in which the criterion was written as somebody else's thread numbers. */
const LEGACY_ENUMERATION = "009/010";

/** The files that state the CURRENT norm — where a foreign number is a condition, not a reference. */
const GUARDED: readonly { readonly path: string; readonly why: string }[] = [
  {
    path: "PROTOCOL.md",
    why: "the norm itself: § «Правила записи», п. 2 and the `waiting-on` pointer",
  },
  {
    path: "packages/agent-protocol/README.md",
    why: "«Commands» — the only description of command form",
  },
  {
    path: ".github/workflows/ci-outcome.yml",
    why: "an executable comment above the legacy branch",
  },
  {
    path: "packages/agent-protocol/src/thread/thread.ts",
    why: "a claim about what this parser reads",
  },
];

describe("the legacy-thread condition is checkable in THIS checkout", () => {
  it.each(GUARDED)("$path names no foreign thread numbers as a condition ($why)", ({ path }) => {
    const file = fileURLToPath(new URL(path, REPO_ROOT));
    const lines = readFileSync(file, "utf8").split("\n");
    const hits = lines
      .map((text, index) => ({ line: index + 1, text }))
      .filter((row) => row.text.includes(LEGACY_ENUMERATION))
      .map((row) => `${path}:${row.line}: ${row.text.trim()}`);
    expect(
      hits,
      `the condition is written as the parent mail's thread numbers ('${LEGACY_ENUMERATION}'), ` +
        "which a reader of THIS repository cannot check: 009 and 010 exist here and are migrated. " +
        "Name the fact instead — a legacy thread is a thread directory without `messages/`, found by " +
        '`for d in agent-comms/[0-9][0-9][0-9]-*; do [ -d "$d/messages" ] || echo "$d"; done`',
    ).toEqual([]);
  });

  /**
   * A guard scoped by path goes silently green when a path is renamed — the failure mode
   * of every file-level allow-list, and the reason this row exists rather than a comment
   * asking the next person to remember.
   */
  it.each(GUARDED)("$path is where this guard thinks it is", ({ path }) => {
    expect(existsSync(fileURLToPath(new URL(path, REPO_ROOT))), `${path} is gone or moved`).toBe(
      true,
    );
  });
});
