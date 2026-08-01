/**
 * THE PROCESS TEST OF `metrics` (thread 029, the narrowing named out loud in msg-025 §3
 * and left as the remainder of the thread in msg-029 §5).
 *
 * The fold is covered by unit tests and the recovery by its own; what NEITHER of them
 * touches is the path the question actually travels — a real CLI process, resolving the
 * box's state on its own (R26), reading the journal of that box, opening the streams
 * beside it and printing. Every defect of that path is invisible to a unit test by
 * construction: a wrong default path, a flag that never reaches the fold, a cache
 * written somewhere nobody reads it. The command was checked by hand before it merged,
 * and a hand is not a runner.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
  instances: [{ id: "main", roles: ["dev-core"] }],
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
      launch: { allowedTools: ["Bash"] },
    },
  ],
};

const line = (event: Record<string, unknown>): string => `${JSON.stringify(event)}\n`;

/** A run with the ledger the writer of PR #123 puts in the journal itself. */
const WITH_BLOCK =
  line({
    kind: "lease-acquired",
    ts: "2026-07-30T10:00:00Z",
    role: "dev-core",
    thread: "016-sync",
    deadline: "2026-07-30T11:00:00Z",
  }) +
  line({
    kind: "lease-released",
    ts: "2026-07-30T10:40:00Z",
    role: "dev-core",
    thread: "016-sync",
    reason: "completed",
    usage: { costUsd: 2, turns: 30, durationSec: 2400 },
  });

/** A run from BEFORE the block: only its stream knows what it cost. */
const WITHOUT_BLOCK =
  line({
    kind: "lease-acquired",
    ts: "2026-07-26T10:00:00Z",
    role: "dev-core",
    thread: "012-protocol",
    deadline: "2026-07-26T11:00:00Z",
  }) +
  line({
    kind: "lease-released",
    ts: "2026-07-26T10:50:00Z",
    role: "dev-core",
    thread: "012-protocol",
    reason: "completed",
  });

/** A run that was killed: no ledger anywhere, and none is to be invented for it. */
const KILLED =
  line({
    kind: "lease-acquired",
    ts: "2026-07-27T10:00:00Z",
    role: "dev-core",
    thread: "012-protocol",
    deadline: "2026-07-27T11:00:00Z",
  }) +
  line({
    kind: "lease-released",
    ts: "2026-07-27T12:00:00Z",
    role: "dev-core",
    thread: "012-protocol",
    reason: "quota-exhausted",
    steps: 120,
  });

const RESULT = line({
  type: "result",
  subtype: "success",
  num_turns: 44,
  duration_ms: 3_000_000,
  total_cost_usd: 7.5,
  usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 50 },
});

type Box = { readonly repo: string; readonly home: string; readonly state: string };

/** A real checkout with a real journal and real streams beside it. */
const box = (): Box => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-metrics-"));
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
    "config",
  ]);

  const state = join(repo, ".orchestrator");
  mkdirSync(join(state, "sessions"), { recursive: true });
  writeFileSync(join(state, "journal.jsonl"), `${WITH_BLOCK}${WITHOUT_BLOCK}${KILLED}`);
  // The stream of the blockless run, named the way the supervisor names it, and the
  // stream of the killed one — which holds steps and no result line at all.
  writeFileSync(
    join(state, "sessions", "2026-07-26T10-00-02Z-dev-core-012-protocol.jsonl"),
    `${line({ type: "assistant", message: { content: "working" } })}${RESULT}`,
  );
  writeFileSync(
    join(state, "sessions", "2026-07-27T10-00-02Z-dev-core-012-protocol.jsonl"),
    line({ type: "assistant", message: { content: "burning the window" } }),
  );
  return { repo, home: configHomeInside(repo), state };
};

const cli = (at: Box, ...args: string[]): string =>
  execFileSync(TSX, [CLI, ...args], { cwd: at.repo, encoding: "utf8", env: sandbox(at.home) });

describe("`metrics` as a process, over the box's own state (R26)", () => {
  it("folds the journal it finds by itself and prices the pre-block run out of its stream", () => {
    const at = box();

    const out = cli(at, "metrics", "--ref", "HEAD");

    // $2 from the journal's own block plus $7.50 recovered from the stream, and the
    // recovery says where the second half came from rather than letting it appear.
    expect(out).toContain("economics: $9.50 · 2 runs with a ledger · 74 turns");
    expect(out).toContain("priced out of their own streams");
    expect(out).toContain("1 runs · 1 streams read now · 0 answered from the cache");
    // The killed run keeps its own row and its tokens are still not counted.
    expect(out).toContain("quota-exhausted  1 runs  120 steps");
    expect(out).toContain("tokens are not counted for these runs");
    // The cache landed in the state directory of THIS box — the whole point of the
    // second call being cheap is that the next process finds it.
    expect(existsSync(join(at.state, "metrics.cache.jsonl"))).toBe(true);
  });

  it("the second process opens no stream — the cache is what one process leaves the next", () => {
    const at = box();
    cli(at, "metrics", "--ref", "HEAD");

    const out = cli(at, "metrics", "--ref", "HEAD");

    expect(out).toContain("economics: $9.50");
    expect(out).toContain("1 runs · 0 streams read now · 1 answered from the cache");
    // The stream with no result line is remembered as a miss too — otherwise exactly the
    // files that can never answer are the ones re-read on every call.
    const cache = readFileSync(join(at.state, "metrics.cache.jsonl"), "utf8");
    expect(cache).toContain("2026-07-26T10-00-02Z-dev-core-012-protocol.jsonl");
  });

  it("--json carries the recovery as a FIELD, for a reader with no eye for a footnote", () => {
    const at = box();

    const folded = JSON.parse(cli(at, "metrics", "--ref", "HEAD", "--json")) as {
      economy: {
        priced: { costUsd: number; runs: number };
        streamRecovery?: { recovered: number; parsed: number };
      };
    };

    expect(folded.economy.priced).toMatchObject({ costUsd: 9.5, runs: 2 });
    expect(folded.economy.streamRecovery).toMatchObject({ recovered: 1, parsed: 1 });
  });

  it("--no-streams answers out of the journal alone, and the difference is visible", () => {
    const at = box();

    const out = cli(at, "metrics", "--ref", "HEAD", "--no-streams");

    expect(out).toContain("economics: $2.00 · 1 runs with a ledger");
    expect(out).not.toContain("priced out of their own streams");
    // The run stays in the printed boundary row instead of quietly vanishing.
    expect(out).toContain("no usage block after the era began: 1 runs");
    expect(existsSync(join(at.state, "metrics.cache.jsonl"))).toBe(false);
  });

  it("a filter reaches the fold: --thread narrows the journal side", () => {
    const at = box();

    const out = cli(at, "metrics", "--ref", "HEAD", "--thread", "016-sync");

    expect(out).toContain("economics: $2.00 · 1 runs with a ledger");
    expect(out).toContain("thread 016-sync");
  });
});
