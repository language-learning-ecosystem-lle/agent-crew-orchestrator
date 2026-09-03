/**
 * WHAT A REFUSAL SHOWS WHEN THE COMMAND WAS NAMED CORRECTLY (thread 089).
 *
 * The measurement behind the repair (curator, 2026-09-03, tree `0f11a010`): one mistyped
 * flag on `mail` answered with `'mail' does not understand what it was given` — the right
 * first line — and then with all 660 lines of the package's help, opening on `config
 * check` and `config set`. The door KNEW the command and did not use that knowledge when
 * choosing what to print, so the working answer sat somewhere in the middle of a page
 * about thirty other commands. #222 had fixed the text of ONE pair (`hold`/`resume`);
 * this file is about the shared path — `guardArguments` (a typo) and `required` (a
 * missing obligatory flag) — for every command that has a block of its own.
 *
 * IT IS A PROCESS TEST AND NOT A UNIT ONE because the claim is about the two things only
 * a real run has: what the CLI actually writes on stderr when its dispatch has recognised
 * a command, and the exit code that goes with it. `usageFor` is unit-tested next door
 * (`orchestrator/argv.test.ts`); what nothing could see from there is whether the DOOR
 * asks it.
 *
 * PINNED BY THREE FACTS AND NEVER BY THE WHOLE TEXT: the command's own usage line is
 * there, no OTHER command's usage line is (asked of every `agent-protocol …` line in the
 * output, so the next command added to the table is judged too), and the exit is 2. The
 * block is a cut of `USAGE` and is meant to move with it; an assertion on the whole
 * output would go red on an unrelated reflow and teach the next reader to re-record it.
 *
 * AND THE TABLE IS A TABLE for the reason the statement gives: fixed on one command, the
 * question "and the next one?" stays unanswered. The five below span the shapes the
 * dispatch has — one word, two words, the mail family, the operator's tail and the
 * `orchestrator *` family, whose key is assembled a token further along.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { configHomeInside, sandbox } from "./testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../node_modules/.bin/tsx", import.meta.url));

const boxes: string[] = [];

/** An empty directory: the run's cwd, and the place a refusal must leave untouched. */
const box = (): string => {
  const made = mkdtempSync(join(tmpdir(), "agent-protocol-usage-"));
  boxes.push(made);
  return made;
};

afterEach(() => {
  for (const made of boxes.splice(0)) rmSync(made, { recursive: true, force: true });
});

const run = (
  cwd: string,
  ...argv: string[]
): { status: number; stderr: string; stdout: string } => {
  const done = spawnSync(TSX, [CLI, ...argv], {
    cwd,
    encoding: "utf8",
    // The machine config lives OUTSIDE the watched directory, so "the refusal wrote
    // nothing" stays a statement about the CLI and not about the sandbox's own scaffolding.
    env: sandbox(configHomeInside(box())),
  });
  return { status: done.status ?? -1, stderr: done.stderr, stdout: done.stdout };
};

/**
 * THE USAGE LINES OF AN OUTPUT — the lines that offer a form, and not the sentence that
 * refuses. `agent-protocol: '<key>' does not understand …` names the command with a
 * COLON after the package name; a usage line has a space there.
 */
const offeredCommands = (text: string): readonly string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("agent-protocol "));

/** The three facts, asked of one refusal: own line present, no foreign line, exit 2. */
const answersAbout = (key: string, done: { status: number; stderr: string }): void => {
  expect(done.status).toBe(2);
  const offered = offeredCommands(done.stderr);
  expect(offered.length).toBeGreaterThan(0);
  // Every offered form is this command's. Written as a filter rather than as a loop of
  // booleans so that a failure names the foreign lines instead of saying `false !== true`.
  expect(offered.filter((line) => !line.startsWith(`agent-protocol ${key} `))).toEqual([]);
  // And the two the measurement of 089 opened on, by name: they are the first thing the
  // whole help text shows, and therefore the first thing a hand read instead of its answer.
  expect(done.stderr).not.toContain("agent-protocol config check");
  expect(done.stderr).not.toContain("agent-protocol config set");
};

/**
 * The shapes of the dispatch, one command each: a bare word, the mail's writing door,
 * a two-word key, the operator's tail, and the `orchestrator *` family.
 */
const TYPO = [
  { key: "mail", argv: ["mail", "--ref", "HEAD", "--role", "curator"] },
  { key: "new-thread", argv: ["new-thread", "--ref", "HEAD"] },
  { key: "zones check", argv: ["zones", "check", "--ref", "HEAD"] },
  { key: "doctor", argv: ["doctor", "--offline"] },
  { key: "orchestrator status", argv: ["orchestrator", "status", "--ref", "HEAD"] },
] as const;

describe("a mistyped flag is answered with the named command's own block", () => {
  it.each(TYPO)("'$key' — its own form, and no other command's", ({ key, argv }) => {
    const cwd = box();

    const done = run(cwd, ...argv, "--bogus-flag");

    // The door still names what it did not understand — that half was never broken.
    expect(done.stderr).toContain(`'${key}' does not understand what it was given`);
    expect(done.stderr).toContain("'--bogus-flag' — unknown flag");
    answersAbout(key, done);
    // A refusal is not a step half-taken: nothing was written anywhere it could write.
    expect(readdirSync(cwd)).toEqual([]);
  });
});

describe("a missing obligatory flag is answered the same way", () => {
  /**
   * `hold`/`resume` are deliberately absent from this table: #222 gave that pair its own
   * refusal text (`HOLD_USAGE`, two forms and the warning that the short one acts), and
   * its process test lives in `orchestrator/operator-tail.process.test.ts`. What 089 is
   * about is every OTHER command, which shared one blind `required`.
   */
  it("`new-thread` with nothing given names --root and offers new-thread", () => {
    const cwd = box();

    const done = run(cwd, "new-thread");

    expect(done.stderr).toContain("--root is not set");
    answersAbout("new-thread", done);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("`mail` without --role names the flag and offers mail", () => {
    const cwd = box();

    const done = run(cwd, "mail", "--root", join(cwd, "agent-comms"), "--ref", "HEAD");

    expect(done.stderr).toContain("--role is not set");
    answersAbout("mail", done);
    // The root it was pointed at does not exist, and a refusal does not create it.
    expect(readdirSync(cwd)).toEqual([]);
  });
});

/**
 * THE TWO CASES THAT KEEP THE WHOLE TEXT, and they are the reason this describe exists:
 * a repair that also ate these would have missed the defect it was aimed at. Neither has
 * a block of its own — there is no command to cut — and "what can this thing do" is
 * exactly the question being asked.
 */
describe("the whole help is still the answer where there is no command to name", () => {
  it("`agent-protocol` with no command prints the package's usage", () => {
    const cwd = box();

    const done = run(cwd);

    expect(done.status).toBe(2);
    expect(done.stderr).toContain("agent-protocol config check");
    expect(done.stderr).toContain("agent-protocol config set");
    // Many commands, not one: the count is what tells this output from a cut block.
    expect(offeredCommands(done.stderr).length).toBeGreaterThan(20);
  });

  it("an unknown command name prints the package's usage", () => {
    const cwd = box();

    const done = run(cwd, "frobnicate", "--bogus-flag");

    expect(done.status).toBe(2);
    expect(done.stderr).toContain("agent-protocol config check");
    expect(offeredCommands(done.stderr).length).toBeGreaterThan(20);
  });
});
