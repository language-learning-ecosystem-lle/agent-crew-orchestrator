/**
 * `config set` AGAINST A REAL FILE — the half `set.test.ts` cannot ask.
 *
 * The decision is a pure function and is tested as one. What a pure function cannot be
 * asked is whether the bytes on disk followed it: that a plan really leaves the file
 * alone, that a refusal really refuses BEFORE the write (which is the whole of п.3 —
 * the strict parser has always caught a broken machine config, but on the next read),
 * and that what lands is JSON this package reads back.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: ".worktrees/comms", ref: "HEAD" },
  instances: [{ id: "lle-agents", roles: ["dev-core"] }],
  roles: [
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the one" },
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
    },
  ],
};

/** A checkout with a config at `HEAD`, and a machine config beside it to edit. */
const box = (local: unknown): { readonly repo: string; readonly path: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-config-set-"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@e",
    "commit",
    "-qm",
    "c",
  ]);
  const path = join(repo, "local.json");
  writeFileSync(path, `${JSON.stringify(local, null, 2)}\n`);
  return { repo, path };
};

const run = (
  repo: string,
  ...args: readonly string[]
): { readonly said: string; readonly code: number } => {
  const done = spawnSync(TSX, [CLI, "config", "set", ...args, "--ref", "HEAD", "--repo", repo], {
    cwd: repo,
    encoding: "utf8",
    env: sandbox(configHomeInside(repo)),
  });
  return { said: `${done.stdout ?? ""}${done.stderr ?? ""}`, code: done.status ?? -1 };
};

describe("config set — the file on disk", () => {
  it("a plan leaves every byte where it was", () => {
    const { repo, path } = box({ agents: {}, instance: "laptop" });
    const before = readFileSync(path, "utf8");
    const { said, code } = run(repo, "instance", "lle-agents", "--local-config", path);
    expect(code).toBe(0);
    expect(said).toContain("--write does it");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("--write changes the one key and keeps the rest of the file", () => {
    const { repo, path } = box({
      agents: { "claude-code": { exec: "/old/claude" } },
      instance: "laptop",
      operator: "dev-core",
    });
    const { code } = run(
      repo,
      "agent",
      "claude-code",
      "--exec",
      "/new/claude",
      "--local-config",
      path,
      "--write",
    );
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      agents: { "claude-code": { exec: "/new/claude" } },
      instance: "laptop",
      operator: "dev-core",
    });
  });

  it("REFUSES A POLICY KEY BEFORE THE WRITE, not on the next read", () => {
    const { repo, path } = box({ agents: {}, instance: "laptop" });
    const before = readFileSync(path, "utf8");
    const { said, code } = run(repo, "limits", "5", "--local-config", path, "--write");
    expect(code).toBe(2);
    expect(said).toContain("POLICY");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("writes nothing when the value is already there — the mtime is an operator's evidence", () => {
    const { repo, path } = box({ agents: {}, instance: "lle-agents" });
    const before = readFileSync(path, "utf8");
    const { said } = run(repo, "instance", "lle-agents", "--local-config", path, "--write");
    expect(said).toContain("already says that");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("commissions the file a box does not have yet", () => {
    const { repo } = box({ agents: {} });
    const fresh = join(repo, "fresh.json");
    const { code } = run(repo, "operator", "dev-core", "--local-config", fresh, "--write");
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(fresh, "utf8"))).toEqual({ agents: {}, operator: "dev-core" });
  });

  it("writes an account beside the one already declared, and reads back through the strict schema", () => {
    const { repo, path } = box({
      agents: {},
      accounts: { "lle-main": { configDir: "/var/empty/agent-protocol-test/main" } },
      instance: "lle-agents",
    });
    // THE PREMISE IS THE TEST'S OWN, NOT THE BOX'S (thread 055, 2026-08-07). This case
    // used to name the operator's real directories, and its claim — "the directory does
    // not exist on this disk, so what comes back is the command that creates it" — was
    // true only until somebody logged that account in. On 2026-08-07 john did exactly
    // that, and the case went red on the box while staying green on the runner, which
    // has no such directory. A path under the test's own temp tree cannot be commissioned
    // out from under it.
    const absent = join(repo, "not-yet", ".claude-second");
    const { said, code } = run(
      repo,
      "account",
      "lle-second",
      "--config-dir",
      absent,
      "--local-config",
      path,
      "--write",
    );
    expect(code).toBe(0);
    // Nothing at that path, and that is the ordinary case: what the operator gets back is
    // the command that creates it, with the path already in it.
    expect(said).toContain(`CLAUDE_CONFIG_DIR=${absent} claude login`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      agents: {},
      accounts: {
        "lle-main": { configDir: "/var/empty/agent-protocol-test/main" },
        "lle-second": { configDir: absent },
      },
      instance: "lle-agents",
    });
  });

  it("…and an account whose directory IS there is not told to log in", () => {
    // The control the case above needs to mean anything: same command, same shape, the
    // only difference being whether the directory exists. Without it a printer that
    // never mentions the login would pass the pair.
    const { repo, path } = box({ agents: {} });
    const { said, code } = run(
      repo,
      "account",
      "lle-second",
      "--config-dir",
      repo,
      "--local-config",
      path,
      "--write",
    );
    expect(code).toBe(0);
    expect(said).not.toContain("claude login");
  });

  it("refuses a typo'd flag at the door, like every other command", () => {
    const { repo, path } = box({ agents: {} });
    const { said, code } = run(
      repo,
      "instance",
      "lle-agents",
      "--nonsense",
      "--local-config",
      path,
    );
    expect(code).toBe(2);
    expect(said).toContain("unknown flag");
  });
});
