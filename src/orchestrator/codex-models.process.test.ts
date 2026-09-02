/**
 * `config check` AS A PROCESS, which is where the pair verdict either arrives or does not
 * (thread `041-model-effort-pair`).
 *
 * The table beside this file proves the DECISION. What a pure function cannot be asked is
 * whether the decision reaches a human: that a wrong pair moves the EXIT CODE and not only
 * a string, that a missing list prints its sentence and still exits 0, and that a healthy
 * config gets no extra word. The defect being closed here is precisely a judgement that
 * never reached the user, so the seam is the test.
 *
 * `CODEX_HOME` IS ALWAYS SET BY THESE TESTS, never left ambient — on the box where the
 * circuit runs the suite that variable may point at a real account with a real cache, and
 * the case "there is no list" would then measure the operator's box instead of the package
 * (the same direction as `sandbox()`'s own removals: green here, red on the runner).
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

/** The vendor's file, cut to the keys the reader claims — a shape, not a snapshot. */
const CACHE = {
  fetched_at: "2026-08-28T20:19:04.947791931Z",
  client_version: "0.150.1",
  models: [
    {
      slug: "narrow-model",
      supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
    },
  ],
};

const configWith = (agent: Record<string, unknown>) => ({
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: ".worktrees/comms", ref: "HEAD" },
  instances: [{ id: "acme-agents", roles: ["pilot-codex"] }],
  roles: [
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the one" },
    {
      id: "pilot-codex",
      kind: "codex",
      status: "active",
      wake: { mode: "watch", session: "crew-pilot-codex" },
      summary: "the pilot of the second tool",
      launch: { agent: { kind: "codex", toolsHeldBy: "sandbox-read-only", ...agent } },
    },
  ],
});

/** A checkout with the config committed at `HEAD`, and a codex home beside it. */
const box = (
  agent: Record<string, unknown>,
  cache: unknown,
): { readonly repo: string; readonly codexHome: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-pair-"));
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify(configWith(agent), null, 2)}\n`,
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
  const codexHome = join(repo, "codex-home");
  mkdirSync(codexHome, { recursive: true });
  if (cache !== undefined) {
    writeFileSync(join(codexHome, "models_cache.json"), `${JSON.stringify(cache, null, 2)}\n`);
  }
  return { repo, codexHome };
};

const check = (
  agent: Record<string, unknown>,
  cache: unknown,
): { readonly out: string; readonly said: string; readonly code: number } => {
  const { repo, codexHome } = box(agent, cache);
  const done = spawnSync(TSX, [CLI, "config", "check", "--ref", "HEAD", "--repo", repo], {
    cwd: repo,
    encoding: "utf8",
    env: sandbox(configHomeInside(repo), { CODEX_HOME: codexHome }),
  });
  return { out: done.stdout ?? "", said: done.stderr ?? "", code: done.status ?? -1 };
};

describe("config check — the pair reaches the exit code", () => {
  it("A WRONG PAIR REFUSES BY NAME: both halves, the levels the model has, and where that was read", () => {
    const { said, code } = check({ model: "narrow-model", effort: "max" }, CACHE);
    expect(code).toBe(1);
    expect(said).toContain("the config does not hold together");
    expect(said).toContain("role 'pilot-codex': model 'narrow-model' × effort 'max'");
    expect(said).toContain("levels low, medium, high");
    expect(said).toContain("models_cache.json");
    expect(said).toContain("codex-cli 0.150.1");
  });

  it("A HEALTHY PAIR PASSES WITHOUT ONE EXTRA WORD — nothing on stderr at all", () => {
    const { out, said, code } = check({ model: "narrow-model", effort: "low" }, CACHE);
    expect(code).toBe(0);
    expect(out).toContain("agent-protocol: ok");
    expect(said).toBe("");
  });

  it("NO LIST IS NOT A PASS AND NOT A REFUSAL: the sentence is printed, the exit code stays 0", () => {
    const { out, said, code } = check({ model: "narrow-model", effort: "max" }, undefined);
    expect(code).toBe(0);
    expect(out).toContain("agent-protocol: ok");
    expect(said).toContain("NOT CHECKED");
    expect(said).toContain("no vendor model list on this box");
    // The two states are told apart by the reader, which is the whole point of printing
    // this line: the same config refuses when the list is there.
    expect(said).not.toContain("the config does not hold together");
  });

  it("a model the list does not name is said out loud too, and is a THIRD sentence", () => {
    const { said, code } = check({ model: "gpt-5-codex", effort: "low" }, CACHE);
    expect(code).toBe(0);
    expect(said).toContain("NOT JUDGED");
    expect(said).toContain("does not name 'gpt-5-codex'");
    expect(said).not.toContain("NOT CHECKED");
  });

  it("a card naming a model and no effort is silent — there is no pair to judge", () => {
    const { said, code } = check({ model: "narrow-model" }, CACHE);
    expect(code).toBe(0);
    expect(said).toBe("");
  });
});
