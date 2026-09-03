/**
 * `--repo` NAMES A PATH, `gh --repo` NAMES `owner/name` — AND THE WRONG ONE USED TO BE
 * ANSWERED WITH AN ENOENT ABOUT `gh` (thread `097-conflict-has-no-signal`).
 *
 * Measured 2026-09-03 while running the brand-new `pr mergeable` against the live PR that
 * carries it: `--repo language-learning-ecosystem-lle/agent-crew-orchestrator` — the
 * spelling `gh` itself takes — got through the contour door, because `contourOf` resolves
 * a RELATIVE path against the caller's directory and the caller stood inside the circuit,
 * so a path that does not exist inherited the circuit's ancestors and was judged "own".
 * The value then reached `execFileSync` as its `cwd`, and Node reports a missing `cwd` as
 * an ENOENT ABOUT THE COMMAND, so the door printed `PR #249 was not read through gh:
 * spawnSync gh ENOENT` — the vendor's binary named for a mistake in the caller's own flag.
 * Nothing can be fixed from that sentence, which is what makes it a defect and not a
 * cosmetic one.
 *
 * IT IS A PROCESS TEST because the claim is about a real `cwd` handed to a real spawn: a
 * unit test of the guard would assert the sentence and prove nothing about whether the
 * spawn is still reached. The two things asserted are therefore the sentence AND that the
 * external call never happens — the second is the half a unit could not see.
 *
 * AND IT ASKS TWO COMMANDS, not one. The guard lives in `repoArg`, which every command
 * resolving a repository goes through; asserting it only where it was measured would
 * record it as a property of `pr mergeable` and let the next command drift.
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
import { configHomeInside, sandbox } from "./testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../node_modules/.bin/tsx", import.meta.url));

/**
 * A `gh` that answers a settled `MERGEABLE` and COUNTS its calls — the count is the point:
 * a guard that refuses after the network call has been made costs what the guard exists to
 * save. The same stub stands in for the `gh` any other command would reach.
 */
const countingGh = (): { bin: string; calls: () => number } => {
  const bin = mkdtempSync(join(tmpdir(), "agent-protocol-repo-flag-"));
  mkdirSync(bin, { recursive: true });
  const log = join(bin, "calls.txt");
  const path = join(bin, "gh");
  writeFileSync(
    path,
    `#!/bin/sh
echo x >> ${JSON.stringify(log)}
printf '{"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN"}\\n'
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

const run = (bin: string, argv: readonly string[]): { code: number; out: string } => {
  const at = mkdtempSync(join(tmpdir(), "agent-protocol-repo-flag-cwd-"));
  try {
    const out = execFileSync(TSX, [CLI, ...argv], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: at,
      env: sandbox(configHomeInside(at), {
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      }),
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/** The exact spelling that was typed on the day, and the one `gh` takes for the same flag. */
const OWNER_NAME = "language-learning-ecosystem-lle/agent-crew-orchestrator";

describe("--repo names a checkout on this machine", () => {
  it("THE FIELD CASE: owner/name is refused by name, before gh is asked", () => {
    const gh = countingGh();
    const result = run(gh.bin, ["pr", "mergeable", "--pr", "249", "--repo", OWNER_NAME]);

    expect(result.code).toBe(2);
    expect(result.out).toContain(`--repo '${OWNER_NAME}' does not exist`);
    // The whole repair: the refusal has to say which of the two meanings this flag carries,
    // because the caller who typed this had the other one in mind and was not wrong to.
    expect(result.out).toContain("a path");
    expect(result.out).toContain("--repo <owner>/<name>");
    // What the old sentence blamed. Naming the vendor's binary for the caller's flag is
    // the defect itself, so its absence is pinned rather than left to the reader.
    expect(result.out).not.toContain("spawnSync gh ENOENT");
    expect(gh.calls()).toBe(0);
  });

  it("is the SHARED door, not a property of one command — merge-gate refuses alike", () => {
    const gh = countingGh();
    const result = run(gh.bin, [
      "merge-gate",
      "--ref",
      "origin/main",
      "--pr",
      "249",
      "--repo",
      OWNER_NAME,
    ]);

    expect(result.code).toBe(2);
    expect(result.out).toContain(`--repo '${OWNER_NAME}' does not exist`);
    expect(gh.calls()).toBe(0);
  });

  it("tells a file from a directory instead of failing later on the cwd", () => {
    const gh = countingGh();
    const at = mkdtempSync(join(tmpdir(), "agent-protocol-repo-flag-file-"));
    const file = join(at, "not-a-checkout.txt");
    writeFileSync(file, "", "utf8");
    const result = run(gh.bin, ["pr", "mergeable", "--pr", "249", "--repo", file]);

    expect(result.code).toBe(2);
    expect(result.out).toContain(`--repo '${file}' is not a directory`);
    expect(gh.calls()).toBe(0);
  });

  it("a --repo that IS a directory still reaches the command it belongs to", () => {
    const gh = countingGh();
    const repo = mkdtempSync(join(tmpdir(), "agent-protocol-repo-flag-ok-"));
    const result = run(gh.bin, ["pr", "mergeable", "--pr", "249", "--repo", repo]);

    expect(result.code).toBe(0);
    expect(gh.calls()).toBe(2);
  });
});
