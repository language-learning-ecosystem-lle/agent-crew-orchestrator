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
/**
 * THE PAYLOAD THE STUB ANSWERS, and why it is a whole one since thread 097: the door now
 * reads the facts of the base note out of THE SAME asks (`statusCheckRollup`, `files`,
 * `baseRefName`), so a stub that answered two fields would test the degradation branch and
 * never the note. The `checks` run is green and started BEFORE the base commit the `gh api`
 * half answers with — that is the drift the note exists for.
 */
const payload = (word: string, options: { readonly checkStartedAt?: string } = {}): string =>
  JSON.stringify({
    number: 482,
    headRefOid: "a".repeat(40),
    body: "thread: 097-conflict-has-no-signal\nrole: dev-core",
    reviews: [],
    commits: [{ oid: "a".repeat(40), committedDate: "2026-09-03T22:00:00Z" }],
    statusCheckRollup: [
      {
        name: "checks",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        startedAt: options.checkStartedAt ?? "2026-09-03T22:30:00Z",
        completedAt: "2026-09-03T22:35:00Z",
      },
    ],
    files: [{ path: "packages/agent-protocol/src/cli.ts" }],
    baseRefName: "main",
    mergeable: word,
    mergeStateStatus: "X",
  });

/**
 * A `gh` that answers the words of `script` in order, one per call, and repeats the last
 * one when the script runs out — the count of `pr view` calls is kept beside it, because
 * "did it ask again" is the assertion this file exists for.
 *
 * `gh api` is counted SEPARATELY and on purpose: the price of the base note is a number
 * curator asked for by name, and a stub that folded the two counts together could not tell
 * "the note cost two calls" from "the door asked about mergeability twice more".
 */
const scriptedGh = (
  words: readonly string[],
  api: { readonly baseCommittedAt?: string; readonly movedPaths?: readonly string[] } = {},
): { bin: string; calls: () => number; apiCalls: () => readonly string[] } => {
  const bin = mkdtempSync(join(tmpdir(), "agent-protocol-pr-mergeable-"));
  mkdirSync(bin, { recursive: true });
  const log = join(bin, "calls.txt");
  const apiLog = join(bin, "api.txt");
  const answers = join(bin, "answers.txt");
  // The paths the comparison answers with go through a FILE, not through the format string
  // of `printf`: a `%s` argument does not interpret `\n`, and the whole list arrived
  // downstream as one path with a backslash in the middle of it — a stub that lies quietly.
  const moved = join(bin, "moved.txt");
  writeFileSync(moved, (api.movedPaths ?? []).map((path) => `${path}\n`).join(""), "utf8");
  writeFileSync(answers, `${words.map((word) => payload(word)).join("\n")}\n`, "utf8");
  const path = join(bin, "gh");
  writeFileSync(
    path,
    `#!/bin/sh
if [ "$1" = "api" ]; then
  echo "$2" >> ${JSON.stringify(apiLog)}
  case "$2" in
    *"commits/main") printf '%s\\t%s\\n' ${JSON.stringify("b".repeat(40))} ${JSON.stringify(api.baseCommittedAt ?? "2026-09-03T22:41:00Z")} ;;
    *"commits?"*) printf '%s\\n' ${JSON.stringify("c".repeat(40))} ;;
    *compare*) cat ${JSON.stringify(moved)} ;;
    *) echo "gh: the stub was asked something it does not answer: $2" >&2; exit 1 ;;
  esac
  exit 0
fi
echo x >> ${JSON.stringify(log)}
n=$(wc -l < ${JSON.stringify(log)} | tr -d ' ')
total=$(wc -l < ${JSON.stringify(answers)} | tr -d ' ')
if [ "$n" -gt "$total" ]; then n=$total; fi
word=$(sed -n "\${n}p" ${JSON.stringify(answers)})
case "$word" in
  *'"mergeable":"BOOM"'*) echo "gh: Resource not accessible by integration" >&2; exit 1 ;;
esac
printf '%s\\n' "$word"
`,
    "utf8",
  );
  chmodSync(path, 0o755);
  const lines = (file: string): readonly string[] =>
    existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
  return { bin, calls: () => lines(log).length, apiCalls: () => lines(apiLog) };
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

  /**
   * JOHN'S BOUNDARY 1, MACHINE-CHECKED (thread 097, «ДА, ТОЛЬКО НОТА»): the note is printed
   * and the door STILL exits zero. Without this case the boundary is a sentence in a
   * comment — the day somebody makes the note refuse, every other test in this file passes.
   */
  it("prints the note about a base that moved INTO the paths of the PR — and still exits 0", () => {
    const gh = scriptedGh(["MERGEABLE", "MERGEABLE"], {
      movedPaths: ["packages/agent-protocol/src/cli.ts", "docs/protocol-reference.md"],
    });
    const result = run(gh.bin, ["--pr", "482"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("the base MOVED after the credited 'checks' started");
    expect(result.out).toContain("moved THROUGH 1 path(s) this pull request also changes");
    expect(result.out).toContain("packages/agent-protocol/src/cli.ts");
    // The label is still permitted — the note speaks, it does not refuse.
    expect(result.out).toContain("the 'review' label may be hung");
    // THE PRICE, AS A NUMBER: three `gh api` calls on the drift branch and not one more —
    // where the base is now, where it was when the credited run started, and the comparison
    // of the two. The asks about mergeability are unchanged at two.
    expect(gh.apiCalls()).toHaveLength(3);
    expect(gh.calls()).toBe(2);
  });

  it("prints the empty intersection too — 'inert' is a measurement, and it costs the same three calls", () => {
    const gh = scriptedGh(["MERGEABLE", "MERGEABLE"], { movedPaths: ["README.md"] });
    const result = run(gh.bin, ["--pr", "482"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("the base moved OUTSIDE the paths of this pull request");
    expect(result.out).toContain("1 path(s) moved, none of them among the 1");
    expect(gh.apiCalls()).toHaveLength(3);
  });

  it("a base older than the credited run: one line, and the two paid calls are NOT made", () => {
    const gh = scriptedGh(["MERGEABLE", "MERGEABLE"], {
      baseCommittedAt: "2026-09-03T20:00:00Z",
    });
    const result = run(gh.bin, ["--pr", "482"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("the base did not move under the credited 'checks'");
    // Only the free half of the note — where the base is now — was paid for.
    expect(gh.apiCalls()).toHaveLength(1);
  });

  it("the refusing branch buys no note at all: a label nobody hangs has no reader", () => {
    const gh = scriptedGh(["CONFLICTING", "CONFLICTING"]);
    const result = run(gh.bin, ["--pr", "482"]);

    expect(result.code).toBe(1);
    expect(gh.apiCalls()).toHaveLength(0);
    expect(result.out).not.toContain("the base MOVED");
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
