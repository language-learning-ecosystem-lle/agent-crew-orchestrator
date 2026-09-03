/**
 * THE PROCESS TEST OF `pr mergeable` — the door before the `review` label (thread
 * `097-conflict-has-no-signal`, john 2026-09-03).
 *
 * `mergeability.test.ts` proves the RULE; nothing there proves that the command asks `gh`
 * more than once, and that is the whole repair. So the stub `gh` here answers a SCRIPT —
 * a different word on each call — and the assertions read both the exit code and how many
 * times it was asked. A command that settled on the first answer would pass every unit
 * test in the package and still burn the round of review this door exists to save.
 *
 * The exit code is asserted on every case because it is the contract with the caller: the
 * role runs this before `gh pr edit --add-label review`, and only `0` means "hang it".
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

/**
 * A `gh` that answers the words of `script` in order, one per call, and repeats the last
 * one when the script runs out — the count of calls is kept beside it, because "did it ask
 * again" is the assertion this file exists for.
 */
const scriptedGh = (words: readonly string[]): { bin: string; calls: () => number } => {
  const bin = mkdtempSync(join(tmpdir(), "agent-protocol-pr-mergeable-"));
  mkdirSync(bin, { recursive: true });
  const log = join(bin, "calls.txt");
  const answers = join(bin, "answers.txt");
  writeFileSync(answers, `${words.join("\n")}\n`, "utf8");
  const path = join(bin, "gh");
  writeFileSync(
    path,
    `#!/bin/sh
echo x >> ${JSON.stringify(log)}
n=$(wc -l < ${JSON.stringify(log)} | tr -d ' ')
total=$(wc -l < ${JSON.stringify(answers)} | tr -d ' ')
if [ "$n" -gt "$total" ]; then n=$total; fi
word=$(sed -n "\${n}p" ${JSON.stringify(answers)})
if [ "$word" = "BOOM" ]; then echo "gh: Resource not accessible by integration" >&2; exit 1; fi
printf '{"mergeable":"%s","mergeStateStatus":"X"}\\n' "$word"
`,
    "utf8",
  );
  chmodSync(path, 0o755);
  return {
    bin,
    calls: () =>
      existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0,
  };
};

const run = (bin: string, extra: readonly string[]): { code: number; out: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-pr-mergeable-repo-"));
  try {
    const out = execFileSync(TSX, [CLI, "pr", "mergeable", "--repo", repo, ...extra], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: repo,
      env: sandbox(configHomeInside(repo), {
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      }),
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

describe("pr mergeable — the door before the `review` label", () => {
  it("asks TWICE even when the first answer is MERGEABLE, and only then says yes", () => {
    const gh = scriptedGh(["MERGEABLE", "MERGEABLE"]);
    const result = run(gh.bin, ["--pr", "482"]);

    expect(result.code).toBe(0);
    expect(gh.calls()).toBe(2);
    expect(result.out).toContain("agreed by two consecutive asks");
    expect(result.out).toContain("the 'review' label may be hung");
  });

  it("THE FIELD CASE: a stale MERGEABLE followed by CONFLICTING refuses, it does not pass", () => {
    const gh = scriptedGh(["MERGEABLE", "CONFLICTING", "CONFLICTING"]);
    const result = run(gh.bin, ["--pr", "482"]);

    expect(result.code).toBe(1);
    expect(gh.calls()).toBe(3);
    expect(result.out).toContain("does not apply to its base (CONFLICTING)");
    // The refusal names the PRICE, not only the state — that is what makes it a door
    // somebody obeys rather than a line somebody reads past.
    expect(result.out).toContain("guard 1");
  });

  it("refuses a reading that never settles, and prints the sequence it heard", () => {
    const gh = scriptedGh(["MERGEABLE", "CONFLICTING", "MERGEABLE"]);
    const result = run(gh.bin, ["--pr", "482"]);

    expect(result.code).toBe(1);
    expect(result.out).toContain("#1 MERGEABLE, #2 CONFLICTING, #3 MERGEABLE");
    expect(result.out).toContain("has not settled");
  });

  it("does not settle on UNKNOWN — 'not computed' is not a permission", () => {
    const gh = scriptedGh(["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
    const result = run(gh.bin, ["--pr", "482"]);

    expect(result.code).toBe(1);
    expect(result.out).toContain("has not finished computing the merge");
  });

  it("honours --asks as a CEILING and still never asks fewer than twice", () => {
    const gh = scriptedGh(["MERGEABLE", "CONFLICTING", "CONFLICTING"]);
    const result = run(gh.bin, ["--pr", "482", "--asks", "2"]);

    expect(gh.calls()).toBe(2);
    expect(result.code).toBe(1);
    expect(result.out).toContain("consecutive answers disagree");
  });

  it("says what gh refused, with the credentials it had, and exits 2 — not 1", () => {
    const gh = scriptedGh(["BOOM"]);
    const result = run(gh.bin, ["--pr", "482"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("was not read through gh");
    expect(result.out).toContain("not accessible by integration");
  });

  it("refuses a --pr that is not a number before asking anything", () => {
    const gh = scriptedGh(["MERGEABLE", "MERGEABLE"]);
    const result = run(gh.bin, ["--pr", "run:482"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("the number of a pull request");
    expect(gh.calls()).toBe(0);
  });

  it("refuses a flag it does not understand instead of swallowing it", () => {
    const gh = scriptedGh(["MERGEABLE", "MERGEABLE"]);
    const result = run(gh.bin, ["--pr", "482", "--tries", "5"]);

    expect(result.code).toBe(2);
    expect(result.out).toContain("does not understand what it was given");
    expect(gh.calls()).toBe(0);
  });
});
