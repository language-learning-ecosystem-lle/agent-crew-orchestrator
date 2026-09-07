/**
 * `orchestrator stop` WITHOUT `--mode` NAMES `orchestrator down` (thread 141, john's word
 * of 2026-09-07 ~13:29Z).
 *
 * THE DEFECT, MEASURED BY curator ON `b33c254c`: the refusal read `--mode is not set` and
 * printed this command's own two forms. It never said `down` — and `down` is the soft stop
 * an operator wants (it sets the same flag AND prints the pid to watch plus the line about
 * launches), the one john used in the field twice that morning. So the hand that obeyed the
 * refusal got the worse of the two soft stops from a text that never named the better one,
 * and the sentence it read was about an unfilled flag rather than about the choice it was
 * actually making. In an outage people read the output of the command, not the manual.
 *
 * IT IS A PROCESS TEST AND NOT A UNIT ONE for the reason its neighbours are: the claim is
 * about what the real CLI writes on a real stream and the code it leaves with. Nothing
 * below `main`'s dispatch can see either.
 *
 * THE THIRD ASSERTION IS THE ONE THAT MAKES THIS A REFUSAL AND NOT A FAILED STOP: the stop
 * flag is looked at BEFORE and AFTER the call, and it is absent both times. A refusal that
 * had already touched the flag would be a stop half-taken wearing the words of a refusal.
 *
 * AND THE FORMS THIS PACKAGE DOES NOT TOUCH ARE ASKED HERE TOO — `--mode graceful` (both
 * with and without `--write`), the wrong-value refusal, the entry into `--mode force`, and
 * `down` itself. They are the whole of what the change could have moved: the mode gate is
 * the first line of the function, everything after it is untouched, and `restart` never
 * reaches this refusal because it passes `--mode` explicitly (`restart.process.test.ts` and
 * `self-restart.process.test.ts` run it).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const boxes: string[] = [];

/** The run's cwd, and the place a refusal must leave exactly as it found it. */
const box = (): string => {
  const made = mkdtempSync(join(tmpdir(), "agent-protocol-stop-"));
  boxes.push(made);
  return made;
};

afterEach(() => {
  for (const made of boxes.splice(0)) rmSync(made, { recursive: true, force: true });
});

/**
 * A box with a repository and a config in it — what the calls that get PAST the mode door
 * need, because from there on the command resolves the box's own paths. The refusal above
 * needs none of it, and that is itself a fact worth keeping: it answers before it has read
 * anything.
 */
const repoBox = (): string => {
  const made = box();
  execFileSync("git", ["init", "-q", "-b", "main", made]);
  writeFileSync(
    join(made, "agent-protocol.json"),
    `${JSON.stringify(
      {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        mail: { branch: "comms", dir: "agent-comms" },
        orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
        roles: [
          { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "op" },
        ],
      },
      null,
      2,
    )}\n`,
  );
  // COMMITTED, not merely written: both commands below resolve the config at a ref
  // (`orchestrator.ref`), and an empty repository answers `invalid object name 'HEAD'`.
  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", made, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
  };
  git("add", "agent-protocol.json");
  git("commit", "-qm", "config");
  return made;
};

const run = (
  cwd: string,
  ...argv: string[]
): { status: number; stderr: string; stdout: string } => {
  const done = spawnSync(TSX, [CLI, ...argv], {
    cwd,
    encoding: "utf8",
    // The machine config lives OUTSIDE the watched directory (R14), so "the refusal wrote
    // nothing" stays a statement about the CLI and not about the sandbox's scaffolding.
    env: sandbox(configHomeInside(box())),
  });
  return { status: done.status ?? -1, stderr: done.stderr, stdout: done.stdout };
};

describe("'orchestrator stop' without --mode offers the choice by both names", () => {
  /**
   * Two shapes of the same mistake: the bare word, and the word with the ref an operator
   * habitually types. Neither carries `--mode`, and the answer must not depend on that.
   */
  const WITHOUT_MODE = [
    { what: "bare", tail: [] as readonly string[] },
    { what: "with --ref", tail: ["--ref", "HEAD"] as readonly string[] },
  ] as const;

  it.each(WITHOUT_MODE)("$what — names 'orchestrator down' and the force form", ({ tail }) => {
    const cwd = box();
    const stopFlag = join(cwd, "stop");
    expect(existsSync(stopFlag)).toBe(false);

    const done = run(cwd, "orchestrator", "stop", ...tail, "--stop-flag", stopFlag);

    // THE SOFT STOP BY NAME — the half the old text did not have at all.
    expect(done.stderr).toContain("orchestrator down");
    // AND THE HARD ONE, so the hand chooses between two rather than obeys one.
    expect(done.stderr).toContain("stop --mode force");
    // The old sentence is gone: this refusal is about the choice, not about a flag.
    expect(done.stderr).not.toContain("agent-protocol: --mode is not set");
    // Non-zero, and this file's code for a call whose FORM is wrong. A stop that was asked
    // for properly and then failed leaves through 1; whatever reads the code must be able
    // to tell "you did not say which stop" from "the stop did not happen".
    expect(done.status).toBe(2);
    // AND NOTHING WAS STOPPED: the flag was absent before the call and is absent after it.
    expect(existsSync(stopFlag)).toBe(false);
    expect(readdirSync(cwd)).toEqual([]);
  });
});

/**
 * WHAT THIS PACKAGE PROMISED NOT TO MOVE. The change is one line — the door on `--mode` —
 * so the regression that matters is that every call which USED to get past that door still
 * does, letter for letter.
 */
describe("the forms the package does not touch answer as they did", () => {
  it("--mode graceful --write creates the stop flag and says so", () => {
    const cwd = box();
    const stopFlag = join(cwd, "stop");

    const done = run(
      cwd,
      "orchestrator",
      "stop",
      "--mode",
      "graceful",
      "--stop-flag",
      stopFlag,
      "--write",
    );

    expect(done.status).toBe(0);
    expect(done.stdout).toContain(
      `agent-protocol: graceful stop — the stop flag '${stopFlag}' was created`,
    );
    expect(existsSync(stopFlag)).toBe(true);
  });

  it("--mode graceful without --write still only describes what it would do", () => {
    const cwd = box();
    const stopFlag = join(cwd, "stop");

    const done = run(cwd, "orchestrator", "stop", "--mode", "graceful", "--stop-flag", stopFlag);

    expect(done.status).toBe(0);
    expect(done.stdout).toContain("would create the stop flag");
    expect(done.stdout).toContain("--write performs it");
    expect(existsSync(stopFlag)).toBe(false);
  });

  it("a --mode nobody declared is still refused by its value, not by the new text", () => {
    const cwd = box();

    const done = run(cwd, "orchestrator", "stop", "--mode", "sideways");

    expect(done.stderr).toContain("--mode 'sideways' — allowed values are graceful | force");
    expect(done.status).toBe(2);
  });

  it("--mode force is entered and refuses on its own obligatory flag", () => {
    const cwd = repoBox();
    const forceFlag = join(cwd, "force");

    const done = run(
      cwd,
      "orchestrator",
      "stop",
      "--mode",
      "force",
      "--ref",
      "HEAD",
      "--force-flag",
      forceFlag,
    );

    // Past the mode door and into the force branch — where `--by` is what is missing. This
    // is the cheap proof that the branch `restart --mode force` composes still opens; the
    // delivery half of it is measured in `force-stop-delivery.process.test.ts`.
    expect(done.stderr).toContain("--by is not set");
    expect(done.status).toBe(2);
    expect(existsSync(forceFlag)).toBe(false);
  });

  it("'orchestrator down' still answers with the pid to watch and the line about launches", () => {
    const cwd = repoBox();
    const stopFlag = join(cwd, "stop");

    const done = run(
      cwd,
      "orchestrator",
      "down",
      "--stop-flag",
      stopFlag,
      "--pid-file",
      join(cwd, "pid"),
    );

    expect(done.status).toBe(0);
    expect(done.stdout).toContain(`the stop flag is set ('${stopFlag}')`);
    // No daemon of this box is running here, so the pid line takes its other half — the
    // one that still answers "is it gone yet".
    expect(done.stdout).toContain("an attached one exits at its next tick");
    expect(done.stdout).toContain(
      "agent-protocol: launches stay enabled — 'orchestrator disable' is the policy switch",
    );
    expect(existsSync(stopFlag)).toBe(true);
  });
});
