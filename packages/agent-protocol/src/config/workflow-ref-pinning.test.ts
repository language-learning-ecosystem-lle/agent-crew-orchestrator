/**
 * A WORKFLOW THAT RUNS THE PACKAGE FROM A CHECKOUT AND READS THE CONFIG AT `origin/main`
 * MUST PIN THAT REF — `--no-fetch`. A claim about this repository's own
 * `.github/`, held in the generic package for the reason `workflow-signatures.test.ts`
 * holds its own: the repository serves itself, and the door that refuses is this package.
 *
 * THE DEFECT IT PINS (thread `180-notifier-down`, 2026-09-09). `merge-notify.yml` takes
 * two checkouts: the mail branch, and the CODE at `ref: main` into `.code`. From that
 * second checkout it runs `cli … --repo . --ref origin/main`. The config loader UPDATES
 * the ref it is given unless told otherwise (`loadProtocolConfig`, `fetch !== false`), so
 * the process reads `main` AS OF THE READ while running the package as of the CHECKOUT —
 * two different commits, and the window between them is a whole job.
 *
 * Measured, not inferred: PR #345 merged 12:33:20Z; the `.code` checkout of its notify run
 * landed on `020a27d5` (a build whose `CURRENT_PROTOCOL_VERSION` is 26) at 12:33:32Z; PR
 * #348 — the bump of the schema to 27 — merged 12:33:33Z; at 12:33:43Z the CLI re-fetched
 * `origin/main`, got `2f17b9cd`, and refused, correctly, with `restart required: the
 * repository declares protocol version 27, the package supports only 26`. The refusal was
 * right and the notification was lost all the same: `new-message отказал для треда
 * 178-zones-door-silent-pass — уведомление НЕ записано` (run `34351698245`, exit 1). The
 * merge notification is the only writer of the fact of a merge into the feed, so the cost
 * of thirteen seconds between two merges is a turn nobody is holding.
 *
 * WHY A SWEEP AND NOT A LINE IN ONE FILE. The pairing is invisible in both halves: the
 * checkout says `ref: main` (correct), the call says `--ref origin/main` (correct), and
 * only reading them TOGETHER shows that one of them moves and the other does not. Four
 * call sites had it; the fifth to be written would have it too. The sweep fails by name
 * with the file and the command, so a new one is red before it is merged.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = new URL("../../../../", import.meta.url);

const SOURCE_DIRS = [
  { dir: fileURLToPath(new URL(".github/workflows/", REPO_ROOT)), ext: ".yml" },
  { dir: fileURLToPath(new URL(".github/scripts/", REPO_ROOT)), ext: ".sh" },
] as const;

/**
 * THE TWO CALL SITES THAT MUST NOT BE PINNED, each for a measured reason, and both named
 * rather than skipped silently:
 *
 * - `foreign-name-watch.yml` checks out `.code` at `${{ github.sha }}`, not at a branch.
 *   A shallow checkout of a commit leaves NO `refs/remotes/origin/main` behind, so the
 *   fetch the loader performs is the only thing that creates the ref this call reads.
 *   `--no-fetch` there would not pin the read — it would abolish it.
 * - `claude-review.yml` hands `.code` to the model, which checks out the PR inside it
 *   during the round (#127). The code that ends up running there is not `main` at any
 *   moment, so pinning `origin/main` to the checkout would buy no pairing — the pairing
 *   is already broken by the second checkout, and that is its own subject.
 */
const UNPINNED_BY_DESIGN = new Set(["foreign-name-watch.yml", "claude-review.yml"]);

interface Call {
  readonly file: string;
  readonly line: number;
  readonly command: string;
}

/**
 * A shell command spans as many lines as it has trailing backslashes, and the flag we are
 * looking for may sit on any of them. Judging line by line would be a test that passes or
 * fails on where somebody wrapped the line.
 */
const commandsOf = (text: string): readonly { line: number; command: string }[] => {
  const lines = text.split("\n");
  const commands: { line: number; command: string }[] = [];
  let start = 0;
  let buffer: string | undefined;
  lines.forEach((raw, index) => {
    const trimmed = raw.trimEnd();
    const continues = trimmed.endsWith("\\");
    const piece = continues ? trimmed.slice(0, -1) : trimmed;
    if (buffer === undefined) {
      start = index + 1;
      buffer = piece;
    } else {
      buffer = `${buffer} ${piece.trim()}`;
    }
    if (!continues) {
      commands.push({ line: start, command: buffer });
      buffer = undefined;
    }
  });
  if (buffer !== undefined) commands.push({ line: start, command: buffer });
  return commands;
};

const collectRefReads = (): readonly Call[] => {
  const found: Call[] = [];
  for (const { dir, ext } of SOURCE_DIRS) {
    for (const name of readdirSync(dir)
      .filter((entry) => entry.endsWith(ext))
      .sort()) {
      for (const { line, command } of commandsOf(readFileSync(join(dir, name), "utf8"))) {
        if (!/--ref\s+origin\/main\b/.test(command)) continue;
        // A commented-out line is not a call: the reasons live in comments here, and they
        // quote the flags they are about.
        if (/^\s*#/.test(command)) continue;
        found.push({ file: name, line, command: command.trim() });
      }
    }
  }
  return found;
};

describe("the config reads this repository's CI performs at origin/main", () => {
  const calls = collectRefReads();

  it("are found at all — an empty sweep would be a green test that checks nothing", () => {
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it("pin the ref with --no-fetch wherever the code they run came from that same ref", () => {
    const unpinned = calls
      .filter((call) => !UNPINNED_BY_DESIGN.has(call.file))
      .filter((call) => !/--no-fetch\b/.test(call.command))
      .map((call) => `${call.file}:${call.line} ${call.command}`);

    expect(unpinned).toEqual([]);
  });

  it("still name the ref by its branch, so the config read is the DEFAULT branch's", () => {
    // The other half of the same seam, and it cost a turn once already: reading `HEAD` of
    // `.code` in `claude-review.yml` read the config out of a PR branch and declared an
    // existing role missing. Pinning must not be mistaken for switching to `HEAD`.
    for (const call of calls) expect(call.command).toContain("--ref origin/main");
  });
});
