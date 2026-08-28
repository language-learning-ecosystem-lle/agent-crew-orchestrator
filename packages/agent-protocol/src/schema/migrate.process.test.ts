/**
 * The PROCESS test of `schema migrate`. The chain planner is covered by unit tests
 * on pure functions; what cannot be covered there is the command's own promise —
 * **a dry run leaves the tree exactly as it found it**, and a config it cannot
 * place in the chain gets a refusal with the repair, not a stack trace.
 *
 * The same reason as for the run observer (`orchestrator/run.process.test.ts`): the
 * expensive defects of this package have always lived in `cli.ts`, in the wiring
 * between the pure core and the disk.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

import { CURRENT_PROTOCOL_VERSION } from "./version.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

/**
 * The fixture sits at the version the package writes RIGHT NOW rather than at a
 * literal: these cases are about "a repository that has nothing left to migrate",
 * and a literal would make every future bump rewrite them into saying something
 * else.
 */
const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
    },
  ],
};

const repoWith = (config: unknown): { repo: string; path: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-schema-"));
  const path = join(repo, "agent-protocol.json");
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"], { encoding: "utf8" });
  return { repo, path };
};

/**
 * BOTH STREAMS, on every exit code. The command says part of what it did on stderr
 * (what is written is not committed; the rendered config has to be formatted), and a
 * helper that returned stdout only would let a note vanish while the test still
 * passed.
 */
const run = (repo: string, ...args: string[]): { code: number; out: string } => {
  const result = spawnSync(TSX, [CLI, "schema", "migrate", "--repo", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: sandbox(configHomeInside(repo)),
  });
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

describe("schema migrate", () => {
  it("says there is nothing to migrate and does not touch the tree", () => {
    const { repo, path } = repoWith(CONFIG);
    const before = readFileSync(path, "utf8");

    const result = run(repo);

    expect(result.code).toBe(0);
    expect(result.out).toContain("nothing to migrate");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("prints the file it read and the version it found — the exception is loud", () => {
    // It is the ONE command that reads the config off the working tree instead of
    // at a ref, so it says so every time rather than leaving the operator to
    // remember which of the two it is looking at.
    const { repo, path } = repoWith(CONFIG);

    const result = run(repo);

    expect(result.out).toContain(path);
    expect(result.out).toContain("working tree");
    expect(result.out).toContain(`version ${CURRENT_PROTOCOL_VERSION}`);
  });

  it("refuses a config that predates versioning and names the repair", () => {
    const { protocolVersion: _dropped, ...rest } = CONFIG;
    const { repo } = repoWith({ version: 1, ...rest });

    const result = run(repo);

    expect(result.code).toBe(2);
    expect(result.out).toContain("protocolVersion");
  });

  it("refuses a downgrade instead of guessing at the older shape", () => {
    const { repo } = repoWith({ ...CONFIG, protocolVersion: 5 });

    const result = run(repo, "--to", "1");

    expect(result.code).toBe(2);
    expect(result.out).toContain("a downgrade is not performed");
  });

  it("refuses a target it has no step for, and writes nothing on the way", () => {
    // The registry holds 1 → 2 (R7) and nothing beyond, so the gap is asked for one
    // version past the current one: a chain whose middle is missing must not be
    // started at all, rather than applied up to the hole.
    const { repo, path } = repoWith(CONFIG);
    const before = readFileSync(path, "utf8");
    const beyond = CURRENT_PROTOCOL_VERSION + 1;

    const result = run(repo, "--to", String(beyond), "--write");

    expect(result.code).toBe(2);
    expect(result.out).toContain(`${CURRENT_PROTOCOL_VERSION} → ${beyond}`);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  /**
   * The seam of the reflow note: the unit test knows the plan re-renders the config,
   * and only the process can say whether the operator was TOLD — and told on the run
   * that actually left a file on disk.
   */
  describe("the rendered config asks for the project's formatter", () => {
    /** One version behind, so the real chain has exactly the last step to apply. */
    const behind = { ...CONFIG, protocolVersion: CURRENT_PROTOCOL_VERSION - 1 };

    it("says so after --write, where a file exists to be formatted", () => {
      const { repo, path } = repoWith(behind);

      const result = run(repo, "--write");

      expect(result.code).toBe(0);
      expect(result.out).toContain("run your project's formatter over it before committing");
      // The claim is about the file that was really produced, not about the plan.
      expect(readFileSync(path, "utf8")).toContain(
        `"protocolVersion": ${CURRENT_PROTOCOL_VERSION}`,
      );
    });

    it("stays quiet on the dry run — nothing was written to format", () => {
      const { repo, path } = repoWith(behind);
      const before = readFileSync(path, "utf8");

      const result = run(repo);

      expect(result.code).toBe(0);
      expect(result.out).not.toContain("formatter");
      expect(readFileSync(path, "utf8")).toBe(before);
    });
  });
});
