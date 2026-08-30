/**
 * THE SEAM OF THE FALL-BACK CHAIN — `config check` AS A PROCESS (thread `036-account-failover`,
 * step 2, point 2).
 *
 * The table beside this file proves the DECISION (`chainRefusals`). What a pure function cannot
 * be asked is whether the decision reaches the person holding the file: that a crooked link moves
 * the EXIT CODE and not only a string, that the sentence names the role and the key, and that the
 * two halves of the R14 join are actually joined here — the chain comes off the REPOSITORY config
 * and the accounts it is judged against come off the MACHINE one. That join is the new path of
 * data this step adds, and a unit on either side of it would not see it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const configWith = (launch: Record<string, unknown>) => ({
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: ".worktrees/comms", ref: "HEAD" },
  instances: [{ id: "acme-agents", roles: ["dev-core"] }],
  roles: [
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the one" },
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "crew-dev-core" },
      summary: "the hands",
      launch: { allowedTools: ["Bash"], account: "acme-second", ...launch },
    },
  ],
});

/** A checkout with the config at `HEAD`, and the machine's own file beside it (never inside it). */
const box = (
  launch: Record<string, unknown>,
  accounts: Record<string, unknown> | undefined,
): { readonly repo: string; readonly localConfig: string | undefined } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-chain-"));
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify(configWith(launch), null, 2)}\n`,
  );
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
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
  if (accounts === undefined) return { repo, localConfig: undefined };
  const home = mkdtempSync(join(tmpdir(), "agent-protocol-machine-"));
  mkdirSync(home, { recursive: true });
  const localConfig = join(home, "local.json");
  writeFileSync(localConfig, `${JSON.stringify({ instance: "acme-agents", accounts }, null, 2)}\n`);
  return { repo, localConfig };
};

const check = (
  launch: Record<string, unknown>,
  accounts?: Record<string, unknown>,
): { readonly out: string; readonly said: string; readonly code: number } => {
  const { repo, localConfig } = box(launch, accounts);
  const done = spawnSync(
    TSX,
    [
      CLI,
      "config",
      "check",
      "--ref",
      "HEAD",
      "--repo",
      repo,
      ...(localConfig === undefined ? [] : ["--local-config", localConfig]),
    ],
    { cwd: repo, encoding: "utf8", env: sandbox(configHomeInside(repo)) },
  );
  return { out: done.stdout ?? "", said: done.stderr ?? "", code: done.status ?? -1 };
};

const DECLARED = {
  "acme-main": { configDir: "/home/lle/.claude", kind: "claude-code" },
  "acme-second": { configDir: "/home/lle/.claude-second", kind: "claude-code" },
  "codex-main": { configDir: "/home/lle/.codex", kind: "codex" },
};

describe("config check — a fall-back chain is judged where it is WRITTEN, not where it is spent", () => {
  it("AN UNDECLARED ACCOUNT REFUSES BY NAME: the role, the key, and the machine field to write", () => {
    const { said, code } = check({ fallback: ["acme-thrid"] }, DECLARED);
    expect(code).toBe(1);
    expect(said).toContain("the config does not hold together");
    expect(said).toContain(
      "role 'dev-core': the fall-back 'acme-thrid' ('roles[].launch.fallback')",
    );
    expect(said).toContain("accounts.acme-thrid.configDir");
  });

  it("AN ACCOUNT OF ANOTHER KIND is refused with both kinds named — a spare tool is not a spare key", () => {
    const { said, code } = check({ fallback: ["codex-main"] }, DECLARED);
    expect(code).toBe(1);
    expect(said).toContain("the fall-back 'codex-main'");
    expect(said).toContain("declares it as 'codex'");
  });

  it("THE ROLE'S OWN ACCOUNT in its own chain is refused", () => {
    const { said, code } = check({ fallback: ["acme-second"] }, DECLARED);
    expect(code).toBe(1);
    expect(said).toContain("the fall-back 'acme-second'");
    expect(said).toContain("already spends");
  });

  it("A HEALTHY CHAIN PASSES WITHOUT ONE EXTRA WORD", () => {
    const { out, said, code } = check({ fallback: ["acme-main"] }, DECLARED);
    expect(code).toBe(0);
    expect(out).toContain("agent-protocol: ok");
    expect(said).toBe("");
  });

  it("AN ABSENT CHAIN AND AN EMPTY ONE ARE THE SAME PASS — the field changes nothing until it is used", () => {
    const absent = check({}, DECLARED);
    const empty = check({ fallback: [] }, DECLARED);
    expect(absent.code).toBe(0);
    expect(empty.code).toBe(0);
    expect(empty.said).toBe(absent.said);
  });

  it("NO MACHINE CONFIG IS NOT A REFUSAL: what this box never said about accounts is not a finding", () => {
    // The chain names an account nobody declared, and the reader has no machine file at all —
    // "this box declares no such account" would then be a sentence about the reader.
    const { out, code } = check({ fallback: ["acme-thrid"] });
    expect(code).toBe(0);
    expect(out).toContain("agent-protocol: ok");
  });
});
