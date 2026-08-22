/**
 * THE PROCESS TEST OF `schema version` — the SEAM, which is the whole command (thread
 * 028). The rendering is proved by `probe.test.ts`; what only a process can prove is
 * that the two numbers are actually FETCHED from where they live: one out of a git tag
 * nobody installed or checked out, the other out of a raw config read at a ref without
 * the loader — whose version gate would refuse the very mismatch being measured.
 *
 * Two repositories, as in life: the package with its cut tag, and the consumer with its
 * config. The numbers are 17 and 18 — the pair of the 2026-08-22 accident.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-08-22T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-08-22T00:00:00Z",
    },
  });

const repo = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  git(dir, "init", "--quiet", "--initial-branch=main", ".");
  git(dir, "config", "user.email", "test@example.invalid");
  git(dir, "config", "user.name", "test");
  return dir;
};

/**
 * The package repository, carrying a tag CUT the way `split-package.sh` cuts one — the
 * package at the root of the tree. That layout is the whole reason the ref is read by
 * two paths: a branch of the host repository has the same file under the prefix.
 */
const packageRepoWithTag = (tag: string, schemaVersion: number): string => {
  const dir = repo("agent-protocol-candidate-");
  mkdirSync(join(dir, "src/schema"), { recursive: true });
  writeFileSync(
    join(dir, "src/schema/version.ts"),
    `/** The shape this build writes. */\nexport const CURRENT_PROTOCOL_VERSION = ${schemaVersion};\n`,
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "agent-protocol" }));
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "the candidate");
  git(dir, "tag", tag);
  return dir;
};

/** The consumer: somebody else's repository, which owns its own pin and its own config. */
const consumerRepoAt = (declared: number): string => {
  const dir = repo("agent-protocol-consumer-");
  writeFileSync(
    join(dir, "agent-protocol.json"),
    `${JSON.stringify({ protocolVersion: declared, mail: { branch: "comms", dir: "agent-comms" }, roles: [] }, null, 2)}\n`,
  );
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "the consumer");
  return dir;
};

const run = (cwd: string, ...args: string[]): { code: number; out: string } => {
  try {
    const out = execFileSync(TSX, [CLI, "schema", "version", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: sandbox(configHomeInside(cwd)),
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

describe("schema version", () => {
  it("reads the CANDIDATE tag's number without installing it, and the consumer's at a ref", () => {
    const candidate = packageRepoWithTag("agent-protocol-v0.2.3", 18);
    const consumer = consumerRepoAt(17);

    const result = run(
      candidate,
      "--package-ref",
      "agent-protocol-v0.2.3",
      "--repo",
      consumer,
      "--ref",
      "main",
    );

    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain("agent-protocol-v0.2.3:src/schema/version.ts");
    expect(result.out).toContain("writes protocol version 18");
    expect(result.out).toContain("declares protocol version 17");
    expect(result.out).toContain("at main");
    expect(result.out).toContain("schema migrate");
  });

  it("exits 0 on the mismatch: this is the measurement taken BEFORE the pin moves, not a door", () => {
    const candidate = packageRepoWithTag("agent-protocol-v0.2.3", 18);
    const behind = run(
      candidate,
      "--package-ref",
      "agent-protocol-v0.2.3",
      "--repo",
      consumerRepoAt(17),
      "--ref",
      "main",
    );
    const ahead = run(
      candidate,
      "--package-ref",
      "agent-protocol-v0.2.3",
      "--repo",
      consumerRepoAt(19),
      "--ref",
      "main",
    );

    expect(behind.code).toBe(0);
    expect(ahead.code).toBe(0);
    // And the two mismatches are told apart by their REPAIR, not by the same sentence.
    expect(ahead.out).toContain("a downgrade is not performed");
    expect(ahead.out).not.toContain("run 'agent-protocol schema migrate'");
  });

  it("is silent about a repair when the numbers already match", () => {
    const candidate = packageRepoWithTag("agent-protocol-v0.2.3", 18);
    const result = run(
      candidate,
      "--package-ref",
      "agent-protocol-v0.2.3",
      "--repo",
      consumerRepoAt(18),
      "--ref",
      "main",
    );

    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain("matches the package");
    expect(result.out).not.toContain("schema migrate");
  });

  it("reads the consumer's WORKING TREE when no --ref is given, and says which it was", () => {
    const consumer = consumerRepoAt(17);
    const result = run(consumer, "--repo", consumer);

    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain("read from the working tree");
    expect(result.out).toContain("declares protocol version 17");
    // With no --package-ref the number is this build's own, and it says so.
    expect(result.out).toContain("this build");
  });

  it("refuses BY NAME a ref that is not a build of the package", () => {
    const result = run(
      consumerRepoAt(18),
      "--package-ref",
      "main",
      "--repo",
      consumerRepoAt(18),
      "--ref",
      "main",
    );

    expect(result.code).toBe(2);
    expect(result.out).toContain("src/schema/version.ts");
    expect(result.out).toContain("--package-repo");
  });

  it("refuses a config that declares no protocol version, naming the field", () => {
    const consumer = repo("agent-protocol-consumer-");
    writeFileSync(join(consumer, "agent-protocol.json"), `${JSON.stringify({ version: 3 })}\n`);
    git(consumer, "add", "-A");
    git(consumer, "commit", "--quiet", "-m", "a config from before versioning");

    const result = run(consumer, "--repo", consumer, "--ref", "main");

    expect(result.code).toBe(2);
    expect(result.out).toContain("protocolVersion");
  });
});
