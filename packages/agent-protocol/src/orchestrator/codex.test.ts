/**
 * THE SECOND KIND, PINNED AGAINST THE VENDOR'S DECLARATIONS (thread 026, step 3).
 *
 * EVERY FIXTURE BELOW NAMES ITS SOURCE in the line above it, and that is the rule the
 * statement of work put on this step: `codex-rs/exec/src/exec_events.rs` at the tree of
 * `@openai/codex@0.149.0`, or a page of `developers.openai.com/codex/`. A fixture with
 * no source is a week away from being indistinguishable from something we made up, and
 * these are all the evidence there is — no `codex` has run on this box (no key yet).
 *
 * THREE KINDS OF ASSERTION LIVE HERE and they answer different questions:
 *
 *  1. the readings, on the vendor's own event shapes;
 *  2. THE ABSENCES — the model, the cost, the limit signal — asserted as EXPECTED
 *     RESULTS rather than as crashes. This is the half a "supported!" implementation
 *     usually skips, and it is the half gate 019 will stand on;
 *  3. the two streams NOT being interchangeable: a claude-code line read by a codex
 *     reader (and the other way round) must produce nothing. Two vendors whose readers
 *     quietly accept each other's lines is how a mixed circuit reports a session id
 *     that was never issued.
 */
import { describe, expect, it } from "vitest";

import {
  buildCodexArgv,
  CODEX,
  codexIsAssistantStep,
  codexModelOf,
  codexRenderLine,
  codexRunUsageOf,
  codexSessionIdOf,
} from "./codex.js";
import { CLAUDE_CODE } from "./kind.js";
import type { buildLaunchArgv } from "./launch.js";
import { isAssistantStep, runUsageOf, sessionIdOf } from "./transcript.js";

/** `exec_events.rs:39-43` — the id `codex exec resume <SESSION_ID>` takes. */
const THREAD_STARTED = JSON.stringify({
  type: "thread.started",
  thread_id: "0199a2be-1b7a-7d63-9b1e-3f4c5d6e7a8b",
});

/** `exec_events.rs:49-72` — the only economics the vendor reports for a finished turn. */
const TURN_COMPLETED = JSON.stringify({
  type: "turn.completed",
  usage: {
    input_tokens: 4120,
    cached_input_tokens: 3072,
    cache_write_input_tokens: 512,
    output_tokens: 380,
    reasoning_output_tokens: 220,
  },
});

/** `exec_events.rs:104-108` — `item.completed` carrying an `agent_message`. */
const AGENT_MESSAGE = JSON.stringify({
  type: "item.completed",
  item: { id: "item_0", type: "agent_message", text: "done" },
});

/** `exec_events.rs:53-56` — a failed turn says prose and nothing else. */
const TURN_FAILED = JSON.stringify({
  type: "turn.failed",
  error: { message: "You've hit your usage limit. Try again later." },
});

/** The launch of a role as the supervisor assembles it, reduced to what argv needs. */
const LAUNCH = {
  prompt: "do the thing",
  maxTurns: "40",
  launch: { allowedTools: ["Bash", "Edit"] },
  denyRules: ["docs/roles/**"],
} as unknown as Parameters<typeof buildLaunchArgv>[0];

describe("the argv of codex is a different tool, not the same tool spelled differently", () => {
  it("puts the prompt positionally, after the options, under `exec`", () => {
    // `exec/src/cli.rs:12-13,76-80`: headless is a SUBCOMMAND and the prompt is a
    // positional argument. `-p` would be `--profile` here (`shared_options.rs:35`).
    expect(buildCodexArgv(LAUNCH)).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "do the thing",
    ]);
    expect(buildCodexArgv(LAUNCH)).not.toContain("-p");
  });

  it("asks for the stream with `--json` and survives a repo-less workspace", () => {
    const argv = buildCodexArgv(LAUNCH);
    // `exec/src/cli.rs:59-66` — one flag where claude-code takes two.
    expect(argv).toContain("--json");
    expect(argv).not.toContain("--output-format");
    // `exec/src/cli.rs:31-33` — codex REFUSES to run outside a git repository, and that
    // refusal would arrive as a dead session rather than as a diagnosis.
    expect(argv).toContain("--skip-git-repo-check");
  });

  it("spells effort as a config override, because codex has no flag for it", () => {
    // `utils/cli/src/config_override.rs:30-32`; the field is `reasoning_effort`
    // (`protocol/src/protocol.rs:2070`). Codex HAS the lever — it just is not a flag.
    const argv = buildCodexArgv({
      ...LAUNCH,
      params: { model: { value: "gpt-5-codex" }, effort: { value: "high" } },
    } as unknown as Parameters<typeof buildLaunchArgv>[0]);
    expect(argv).toContain("-m");
    expect(argv).toContain("gpt-5-codex");
    expect(argv).toContain("-c");
    expect(argv).toContain("model_reasoning_effort=high");
    // Still last, still positional: an option value must not swallow the prompt.
    expect(argv.at(-1)).toBe("do the thing");
  });

  it("resumes through the subcommand, not through a flag", () => {
    // `codex/noninteractive.md`: `codex exec resume <SESSION_ID>`.
    const argv = buildCodexArgv({ ...LAUNCH, resume: "0199a2be-1b7a-7d63-9b1e-3f4c5d6e7a8b" });
    expect(argv.slice(0, 3)).toEqual(["exec", "resume", "0199a2be-1b7a-7d63-9b1e-3f4c5d6e7a8b"]);
    expect(argv).not.toContain("--resume");
  });

  it("drops the three levers codex has no lever for — and names them out loud", () => {
    // The role above asks for tools, zones and a turn ceiling. None of the three can be
    // said to codex (B2 of the inventory), so none of them appears in the argv...
    const argv = buildCodexArgv(LAUNCH);
    expect(argv).not.toContain("--allowedTools");
    expect(argv).not.toContain("--settings");
    expect(argv).not.toContain("--max-turns");
    // ...and the silence is not where the story ends: the absence is declared, which is
    // what lets a door refuse such a role BY NAME instead of raising it half-armed.
    expect(CODEX.cannot).toContain("allowed-tools");
    expect(CODEX.cannot).toContain("zone-deny");
    expect(CODEX.cannot).toContain("max-turns");
    // Effort is NOT among them: it is spelled as config, not missing.
    expect(CODEX.cannot).not.toContain("effort");
  });
});

describe("the readings of the codex stream", () => {
  it("reads the session id off `thread.started`", () => {
    expect(codexSessionIdOf(THREAD_STARTED)).toBe("0199a2be-1b7a-7d63-9b1e-3f4c5d6e7a8b");
    expect(CODEX.stream.sessionIdOf(THREAD_STARTED)).toBe(codexSessionIdOf(THREAD_STARTED));
    expect(codexSessionIdOf(TURN_COMPLETED)).toBeUndefined();
  });

  it("counts an `agent_message` as a step and other items as not one", () => {
    expect(codexIsAssistantStep(AGENT_MESSAGE)).toBe(true);
    // `item.completed` of another type is work, not the session speaking.
    expect(
      codexIsAssistantStep(
        JSON.stringify({ type: "item.completed", item: { id: "i1", type: "command_execution" } }),
      ),
    ).toBe(false);
    // An item that only STARTED has not happened yet.
    expect(
      codexIsAssistantStep(
        JSON.stringify({ type: "item.started", item: { id: "i2", type: "agent_message" } }),
      ),
    ).toBe(false);
  });

  it("carries the vendor's token counts unedited and omits the fields it does not report", () => {
    const usage = codexRunUsageOf(TURN_COMPLETED);
    expect(usage?.tokens).toEqual({ in: 4120, out: 380, cacheWrite: 512, cacheRead: 3072 });
    // `out` is the vendor's own `output_tokens`: `reasoning_output_tokens` (220) is NOT
    // folded in, because the schema never says whether it is already inside it.
    expect(usage?.tokens?.out).toBe(380);
    // THE ABSENCES ARE THE POINT. Codex reports no turn count, no wall time and no cost
    // (B3: it does not price its own run) — and a zero here would be read as "free".
    expect(usage && "costUsd" in usage).toBe(false);
    expect(usage && "turns" in usage).toBe(false);
    expect(usage && "durationSec" in usage).toBe(false);
    expect(codexRunUsageOf(AGENT_MESSAGE)).toBeUndefined();
  });

  it("says the model is unknown rather than echoing what we asked for", () => {
    // No event type of `exec --json` declares a model (`exec_events.rs:11-36`). The
    // honest answer is an empty one — a model in the log is read as the tool's word.
    for (const line of [THREAD_STARTED, TURN_COMPLETED, AGENT_MESSAGE, TURN_FAILED]) {
      expect(codexModelOf(line)).toBeUndefined();
      expect(CODEX.stream.modelOf(line)).toBeUndefined();
    }
  });

  it("renders each event as a row and keeps a foreign line verbatim", () => {
    expect(codexRenderLine(THREAD_STARTED)[0]).toContain("0199a2be-1b7a-7d63-9b1e-3f4c5d6e7a8b");
    expect(codexRenderLine(TURN_FAILED)[0]).toContain("usage limit");
    expect(codexRenderLine(AGENT_MESSAGE)[0]).toContain("agent_message");
    // A launcher's refusal on stdout is not JSON and is not lost.
    expect(codexRenderLine("codex: command not found")).toEqual(["codex: command not found"]);
    expect(codexRenderLine("   ")).toEqual([]);
    // A ninth event type from a newer codex: named, not swallowed and not thrown on.
    expect(codexRenderLine(JSON.stringify({ type: "turn.paused" }))).toEqual(["turn.paused"]);
  });
});

describe("what this kind cannot say, it does not say", () => {
  it("has no limit readers at all — the absence IS the answer (B4)", () => {
    // The rate-limit types exist in the vendor's internal protocol but never reach the
    // JSONL of `codex exec`. So the members are missing, and a caller asking gets
    // `undefined` — the difference between "no shelf to build" and "no limits ever".
    expect(CODEX.stream.quotaSignalOf).toBeUndefined();
    expect(CODEX.stream.windowBoundaryOf).toBeUndefined();
    // Even the one line that looks like a limit in prose is NOT read as a signal: a
    // wording nobody on this box has seen would be a guess wearing a reading's clothes.
    expect(CODEX.stream.quotaSignalOf?.(TURN_FAILED)).toBeUndefined();
    // ...and it is named, so a refusal can print it rather than shrug.
    expect(CODEX.cannot).toContain("quota-signal");
    expect(CODEX.cannot).toContain("quota-window");
  });

  it("names its binary, its account variable and its stream pipe", () => {
    expect(CODEX.id).toBe("codex");
    expect(CODEX.defaultExec).toBe("codex");
    // B5: the account is a directory here too — only the variable's name differs.
    expect(CODEX.accountEnv).toBe("CODEX_HOME");
    // stdout carries the JSONL; the progress goes to stderr (`noninteractive.md`).
    expect(CODEX.stream.pipe).toBe("stdout");
  });

  it("probes without `-p`, the flag that means a profile on this binary", () => {
    const argv = CODEX.probeArgv("Answer with the single word: ok");
    expect(argv).not.toContain("-p");
    expect(argv[0]).toBe("exec");
    expect(argv.at(-1)).toBe("Answer with the single word: ok");
    // A probe that can write is a probe that can break the box it is diagnosing.
    expect(argv).toContain("--sandbox");
    expect(argv).toContain("read-only");
  });

  it("dictates ITS repair, with the key on stdin and never in an argument", () => {
    const withDir = CODEX.loginHint("/root/.codex-pilot");
    expect(withDir).toContain("CODEX_HOME=/root/.codex-pilot");
    expect(withDir).toContain("codex login --with-api-key");
    // The one thing a repair line must never do: put a secret where `ps` can read it.
    expect(withDir).not.toContain("sk-");
    expect(CODEX.loginHint()).toBe("printenv OPENAI_API_KEY | codex login --with-api-key");
    // And not a word of the other vendor — the defect this whole step exists against.
    expect(withDir).not.toContain("claude");
    expect(CODEX.loginHint()).not.toContain("claude");
  });
});

describe("the two streams are not interchangeable", () => {
  const CLAUDE_INIT = JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b",
    model: "claude-opus-4",
  });
  const CLAUDE_RESULT = JSON.stringify({ type: "result", num_turns: 3, duration_ms: 10 });
  const CLAUDE_STEP = JSON.stringify({ type: "assistant", message: { content: [] } });

  it("gives nothing when a codex reader is handed a claude-code line", () => {
    // Same question, other vendor's words: a reader that answered here would report a
    // session id that was never issued on a mixed circuit.
    expect(codexSessionIdOf(CLAUDE_INIT)).toBeUndefined();
    expect(codexRunUsageOf(CLAUDE_RESULT)).toBeUndefined();
    expect(codexIsAssistantStep(CLAUDE_STEP)).toBe(false);
  });

  it("gives nothing when a claude-code reader is handed a codex line", () => {
    expect(sessionIdOf(THREAD_STARTED)).toBeUndefined();
    expect(runUsageOf(TURN_COMPLETED)).toBeUndefined();
    expect(isAssistantStep(AGENT_MESSAGE)).toBe(false);
    // The kind reached through the contract answers the same way as the function.
    expect(CLAUDE_CODE.stream.sessionIdOf(THREAD_STARTED)).toBeUndefined();
  });
});
