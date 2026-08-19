/**
 * NO WORKFLOW OF THIS REPOSITORY APPENDS TO `_thread.md` BY SHELL. A claim about this
 * repository's own `.github/workflows`, held in the generic package for the reason
 * `workflow-signatures.test.ts` and `legacy-condition.test.ts` hold theirs: the
 * repository serves itself.
 *
 * WHAT IT PINS (thread `014-merge-model`, decision of john 2026-08-19 — «сносить»). Two
 * workflows carried an executable SECOND path of writing into a thread: for a thread
 * directory WITHOUT `messages/` they counted `msg-NNN` themselves and appended a section
 * to `_thread.md` (`merge-notify.yml`, an `else` branch; `claude-review.yml`, the same
 * shape inside the reviewer's prompt). The branch was dead — measured, not inferred
 * (dev-core, same thread): no thread directory of this mail lacks `messages/`, and a new
 * one cannot appear, since `new-thread`/`new-message` put the message in `messages/` and
 * nobody writes the mail by hand (R3). It was also FATAL if ever reached: `_thread.md` is
 * a DERIVED file, and the generator rebuilds it from `messages/` without the appended
 * section — the notification would vanish silently. john's word settled the asymmetry as
 * intentional: the protocol READS legacy (history) and does NOT WRITE it.
 *
 * WHAT THIS TEST IS AND IS NOT, named rather than implied. It bans one SHAPE — a shell
 * redirection (`>>`, `tee -a`) whose target is `_thread.md`, either literally or through
 * a variable this file itself assigns that path to. That shape is what an executable
 * append looks like in every one of the removed sites, in a workflow's `run:` and in the
 * prompt text a workflow feeds an agent alike, which is why the sweep does not try to
 * tell those two apart.
 *
 * It deliberately does NOT touch:
 * - READING legacy — neither in the workflows (`claude-review.yml` tells the reviewer
 *   that a legacy thread is a single `_thread.md`, and that stays true) nor in the core,
 *   where `loadThreads`/`derive` read such threads on purpose;
 * - the GENERATOR — `comms-derived.yml` writes `_thread.md` on every push, and must: it
 *   does so through `derive --write`, i.e. the package, not a shell append. A guard that
 *   banned the file name here would ban the one legitimate writer;
 * - prose that MENTIONS the file, including the records of this very removal.
 *
 * A second writer dressed in some other shape (a heredoc into `python`, an append via a
 * helper script) is not caught here — that is a reviewer's judgement, and it is said out
 * loud so nobody reads a green run as wider than it is.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = new URL("../../../../", import.meta.url);

/** The derived file that used to be the target of the second write path. */
const DERIVED_THREAD_FILE = "_thread.md";

/**
 * The workflows this guard is about, each with why it is here. Named rather than globbed:
 * a glob that silently matches nothing is exactly the failure this file's second row
 * exists to prevent, and these three are the ones the removal touched or reasons about.
 */
const GUARDED: readonly { readonly path: string; readonly why: string }[] = [
  {
    path: ".github/workflows/merge-notify.yml",
    why: "the only writer of the fact of a merge — its `else` branch was the append",
  },
  {
    path: ".github/workflows/claude-review.yml",
    why: "the reviewer's verdict — the same append lived in the prompt text",
  },
  {
    path: ".github/workflows/ci-outcome.yml",
    why: "it describes the neighbours' write paths and must not grow one",
  },
  {
    path: ".github/workflows/comms-derived.yml",
    why: "the generator: it writes the file through the package, and must keep doing so",
  },
];

/** `VAR="…/_thread.md"` — the only reason to hold that path in a shell variable is to write to it. */
const ASSIGNS_THREAD_FILE = /([A-Za-z_][A-Za-z0-9_]*)=["']?[^"'\s]*_thread\.md/g;

/** A shell append: `>> target` or `tee -a target`. `>>&` and `2>>` are the same shape. */
const APPENDS_TO = (target: string): RegExp =>
  new RegExp(`(>>\\s*|tee\\s+(-\\w+\\s+)*-a\\w*\\s+)["']?[^"'\\s]*${target}`);

/**
 * The append sites of one file: the literal name, plus every variable this file assigns
 * that path to — an append writes `>> "$THREAD_FILE"`, never the path twice.
 */
const appendSites = (source: string): string[] => {
  const holders = [...source.matchAll(ASSIGNS_THREAD_FILE)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
  const targets = [DERIVED_THREAD_FILE, ...holders.map((name) => `\\$\\{?${name}\\}?`)];
  return source
    .split("\n")
    .map((text, index) => ({ line: index + 1, text }))
    .filter((row) => targets.some((target) => APPENDS_TO(target).test(row.text)))
    .map((row) => `${row.line}: ${row.text.trim()}`);
};

describe("the protocol reads legacy threads and writes none", () => {
  it.each(GUARDED)("$path appends nothing to `_thread.md` by shell ($why)", ({ path }) => {
    const source = readFileSync(fileURLToPath(new URL(path, REPO_ROOT)), "utf8");
    expect(
      appendSites(source).map((site) => `${path}:${site}`),
      "a workflow writes a thread by appending to `_thread.md` — the DERIVED file the " +
        "generator rebuilds from `messages/`, so the write disappears on the next push. " +
        "Threads are written through `new-message` (R3); a thread directory without " +
        "`messages/` cannot appear in this mail, and if one did the answer is a loud " +
        "refusal, not a second writer (decision of john 2026-08-19, thread 014-merge-model)",
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
