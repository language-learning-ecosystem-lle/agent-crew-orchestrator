/**
 * THE KIND CONTRACT (thread 026, step 2). Two kinds of assertion live here and they
 * answer different questions.
 *
 * The first is the REGRESSION of a refactoring: `claude-code` reached through the
 * contract must produce, byte for byte, the argv and the readings the circuit was
 * already running on. This repository raises its own sessions with this code — an
 * argv that shifted by one flag during a "pure move" is a fault that would show up as
 * a dead session, not as a red test, so the move is pinned here instead.
 *
 * The second is the SHAPE the second kind needs: that the seven properties are asked
 * OF the kind and not of a string comparison, and that the two answers a kind is
 * allowed to give — "here is how" and "I have no lever for that" — are both
 * expressible. The codex work lands against these assertions, so they are written
 * from the contract's side rather than from claude-code's.
 */
import { describe, expect, it } from "vitest";

import { AGENT_KINDS, CLAUDE_CODE, execNameOf, kindOf, unknownKindRefusal } from "./kind.js";
import { buildLaunchArgv, DEFAULT_EXEC, DEFAULT_WORKER } from "./launch.js";
import { quotaSignalOf, windowBoundaryOf } from "./quota.js";
import { isAssistantStep, modelOf, runUsageOf, sessionIdOf } from "./transcript.js";

/** The launch of a role as the supervisor assembles it, reduced to what argv needs. */
const LAUNCH = {
  prompt: "do the thing",
  maxTurns: "40",
  launch: { allowedTools: ["Bash", "Edit"] },
  denyRules: ["docs/roles/**"],
} as unknown as Parameters<typeof buildLaunchArgv>[0];

describe("the kind of claude-code is the code that was already running", () => {
  it("builds the same argv through the contract as by the function name", () => {
    expect(CLAUDE_CODE.buildArgv(LAUNCH)).toEqual(buildLaunchArgv(LAUNCH));
  });

  it("reads the stream with the same four extractions", () => {
    const init = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b",
      model: "claude-opus-4",
    });
    expect(CLAUDE_CODE.stream.sessionIdOf(init)).toBe(sessionIdOf(init));
    expect(CLAUDE_CODE.stream.modelOf(init)).toBe(modelOf(init));
    const step = JSON.stringify({ type: "assistant", message: { content: [] } });
    expect(CLAUDE_CODE.stream.isAssistantStep(step)).toBe(isAssistantStep(step));
    const done = JSON.stringify({ type: "result", num_turns: 3, duration_ms: 10 });
    expect(CLAUDE_CODE.stream.runUsageOf(done)).toBeDefined();
    expect(CLAUDE_CODE.stream.runUsageOf(done)).toEqual(runUsageOf(done));
    expect(CLAUDE_CODE.stream.sessionIdOf(init)).toBeDefined();
  });

  it("reads the limit signal and the window edge with the same two readers", () => {
    // The exact prose of the vendor (A5 of the inventory), so that the assertion is
    // about the WIRING and not about a signal invented for the test.
    const refused = JSON.stringify({
      type: "result",
      subtype: "error",
      result: "Claude AI usage limit reached|1754006400",
    });
    // Asserted DEFINED first: two readers agreeing on `undefined` would pass this
    // test with the wiring cut, which is the one failure it exists to catch.
    expect(CLAUDE_CODE.stream.quotaSignalOf?.(refused)).toBeDefined();
    expect(CLAUDE_CODE.stream.quotaSignalOf?.(refused)).toEqual(quotaSignalOf(refused));
    const allowed = JSON.stringify({
      type: "system",
      subtype: "rate_limit_event",
      rate_limit_info: { status: "allowed", resetsAt: 1754006400, rateLimitType: "five_hour" },
    });
    expect(CLAUDE_CODE.stream.windowBoundaryOf?.(allowed)).toBeDefined();
    expect(CLAUDE_CODE.stream.windowBoundaryOf?.(allowed)).toEqual(windowBoundaryOf(allowed));
  });

  it("names its binary, its account variable and its stream pipe", () => {
    expect(CLAUDE_CODE.id).toBe(DEFAULT_WORKER);
    expect(CLAUDE_CODE.defaultExec).toBe(DEFAULT_EXEC);
    // The name that was hardcoded in two spots of the spawn until this module (A1).
    expect(CLAUDE_CODE.accountEnv).toBe("CLAUDE_CONFIG_DIR");
    expect(CLAUDE_CODE.stream.pipe).toBe("stdout");
  });

  it("probes with `-p` — the flag that means something else on the other tool", () => {
    // The trap of B1, pinned: `-p` is the prompt here and `--profile` on codex. The
    // day a second kind lands, this assertion is what keeps its probe from inheriting
    // this one silently.
    expect(CLAUDE_CODE.probeArgv("Answer with the single word: ok")).toEqual([
      "-p",
      "Answer with the single word: ok",
    ]);
  });

  it("dictates the repair with the directory in it, and without one when there is none", () => {
    expect(CLAUDE_CODE.loginHint("/home/j/.claude-second")).toBe(
      "CLAUDE_CONFIG_DIR=/home/j/.claude-second claude login",
    );
    expect(CLAUDE_CODE.loginHint()).toBe("claude login");
  });

  it("has no lever it cannot honour — the absences belong to the other tool", () => {
    expect(CLAUDE_CODE.cannot).toEqual([]);
  });
});

describe("the registry answers by name and refuses by name", () => {
  it("finds the one kind this package raises", () => {
    expect(kindOf("claude-code")).toBe(CLAUDE_CODE);
    expect(AGENT_KINDS).toContain(CLAUDE_CODE);
  });

  it("does not invent a kind it has not implemented", () => {
    // Not a fallback to claude-code: a fallback here would spend the wrong account.
    expect(kindOf("codex")).toBeUndefined();
  });

  it("names what was asked for, what exists and the field to change", () => {
    const said = unknownKindRefusal("codex");
    expect(said).toContain("codex");
    expect(said).toContain("claude-code");
    expect(said).toContain("agent.kind");
  });

  it("guesses the binary of an unknown kind from its id, and knows the one it has", () => {
    expect(execNameOf("claude-code")).toBe("claude");
    // A guess that costs nothing: it is looked up on PATH and a miss asks for `--exec`.
    expect(execNameOf("cursor")).toBe("cursor");
  });
});
