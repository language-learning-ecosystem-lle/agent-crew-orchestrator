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

import { CODEX } from "./codex.js";
import {
  AGENT_KINDS,
  CLAUDE_CODE,
  execNameOf,
  kindLeverRefusal,
  kindOf,
  leversAskedFor,
  resolveExec,
  unknownKindRefusal,
} from "./kind.js";
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

  it("reads the reason of a failed probe off the FIRST line — this tool's rule (thread 039)", () => {
    // The rule doctor applied to every tool until thread 039, kept here where it is true:
    // claude-code says why it refused first and alone.
    expect(CLAUDE_CODE.probeFailure("Not logged in · Please run /login\nsomething after")).toBe(
      "Not logged in · Please run /login",
    );
    // Nothing readable in it is answered as nothing, so the caller can fall back to the
    // error the spawn itself raised rather than print an empty row.
    expect(CLAUDE_CODE.probeFailure("\n  \n")).toBe("");
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
  it("finds the kinds this package raises", () => {
    expect(kindOf("claude-code")).toBe(CLAUDE_CODE);
    expect(kindOf("codex")).toBe(CODEX);
    expect(AGENT_KINDS).toContain(CLAUDE_CODE);
    expect(AGENT_KINDS).toContain(CODEX);
  });

  it("does not invent a kind it has not implemented", () => {
    // Not a fallback to claude-code: a fallback here would spend the wrong account.
    expect(kindOf("cursor")).toBeUndefined();
  });

  it("names what was asked for, what exists and the field to change", () => {
    const said = unknownKindRefusal("cursor");
    expect(said).toContain("cursor");
    // Both implemented kinds are offered — a refusal listing only one of them would
    // send its reader to the wrong tool as surely as no refusal at all.
    expect(said).toContain("claude-code");
    expect(said).toContain("codex");
    expect(said).toContain("agent.kind");
  });

  it("guesses the binary of an unknown kind from its id, and knows the one it has", () => {
    expect(execNameOf("claude-code")).toBe("claude");
    // A guess that costs nothing: it is looked up on PATH and a miss asks for `--exec`.
    expect(execNameOf("cursor")).toBe("cursor");
  });
});

/**
 * WHERE A TOOL'S BINARY IS (R14), and the defect thread 026 measured on a live box:
 * the last layer of this resolution used to be the constant `claude`, so a role
 * declaring `kind: codex` was raised by the WRONG VENDOR'S binary and preflight printed
 * it as a tick — `✓ agent: binary (codex): …/claude (default)`.
 *
 * The order of the layers is unchanged and is pinned here as such: the flag, then the
 * machine config, then the name the kind itself declares.
 */
describe("resolveExec — where its binary is", () => {
  const local = { agents: { "claude-code": { exec: "/home/j/.nvm/bin/claude" } } };

  it("no machine config → the name the KIND declares, said to be the kind's", () => {
    expect(resolveExec({ worker: "claude-code" })).toEqual({
      value: DEFAULT_EXEC,
      source: "kind",
    });
    // The whole point of the fix: a second kind gets its own vendor's name, not the
    // first kind's binary under a tick.
    expect(resolveExec({ worker: "codex" })).toEqual({ value: "codex", source: "kind" });
  });

  it("a machine config that names other tools does not answer for codex either", () => {
    // The live shape of the defect: the box declares `claude-code` (and only it), and
    // the codex role used to fall through to the claude binary.
    expect(resolveExec({ worker: "codex", local })).toEqual({ value: "codex", source: "kind" });
  });

  it("the machine config answers for the tool it names", () => {
    expect(resolveExec({ worker: "claude-code", local })).toEqual({
      value: "/home/j/.nvm/bin/claude",
      source: "machine",
    });
  });

  it("…and for codex too — the declared path beats the vendor's name", () => {
    expect(
      resolveExec({
        worker: "codex",
        local: { agents: { codex: { exec: "/opt/codex/bin/codex" } } },
      }),
    ).toEqual({ value: "/opt/codex/bin/codex", source: "machine" });
  });

  it("…and only for that tool: another tool falls through, it does not inherit", () => {
    // The map is keyed on the tool for a reason. Handing `cursor` the path to
    // `claude` because it happened to be the only entry would be the silent wrong
    // start this whole layer exists to prevent.
    const guess = resolveExec({ worker: "cursor", local });
    // An id this package does not implement is a GUESS and says so — told apart from
    // the kind's own declaration, because a reader chasing a wrong binary needs to know
    // whether anybody ever declared this name.
    expect(guess).toEqual({ value: "cursor", source: "worker-id" });
  });

  it("the flag beats the machine — checks aim at a stub, acceptance at the real binary", () => {
    expect(resolveExec({ flag: "/tmp/stub.sh", worker: "claude-code", local })).toEqual({
      value: "/tmp/stub.sh",
      source: "flag",
    });
    expect(resolveExec({ flag: "/tmp/stub.sh", worker: "codex" }).source).toBe("flag");
  });
});

/**
 * THE LAUNCH DOOR OF PROPERTY 7 (step 3, point 4). What is pinned here is the ARITHMETIC
 * of the door — which asks exist and which of them a kind cannot honour; the words of the
 * real command are pinned by `kind-lever.process.test.ts`.
 */
describe("the levers a role asks for against the ones its kind has", () => {
  const asks = leversAskedFor({
    allowedTools: ["Bash", "Edit"],
    denyRules: ["Edit(docs/roles/**)"],
    maxTurns: { value: 40, source: "role" },
    effort: { value: "high", source: "role" },
  });

  it("reads an ask off each field that carries one, and names where it is written", () => {
    expect(asks.map((ask) => ask.lever)).toEqual([
      "allowed-tools",
      "zone-deny",
      "max-turns",
      "effort",
    ]);
    // The field, not just the lever: this half is what a reader of the refusal acts on.
    expect(asks[0]?.where).toContain("launch.allowedTools");
    expect(asks[2]?.where).toContain("40");
    expect(asks[2]?.where).toContain("role");
  });

  it("counts an empty field as no ask at all", () => {
    // A role with no zones does not ask for zone denial, and a package default is not a
    // role asking for a ceiling — refusing on either would be a refusal about US.
    expect(leversAskedFor({ allowedTools: [], denyRules: [] })).toEqual([]);
    expect(leversAskedFor({})).toEqual([]);
  });

  it("refuses BY NAME on the levers codex has no way to honour, and only on those", () => {
    const said = kindLeverRefusal({ kind: CODEX, role: "dev-core", asks });
    expect(said).toContain("role 'dev-core'");
    expect(said).toContain("'codex'");
    expect(said).toContain("allowed-tools");
    expect(said).toContain("zone-deny");
    expect(said).toContain("max-turns");
    // EFFORT IS NOT AMONG THEM: codex has it and spells it `-c model_reasoning_effort=`,
    // so a refusal naming it would be this door lying about the tool.
    expect(said).not.toContain("effort '");
  });

  it("says nothing when the kind has every lever asked of it", () => {
    // `claude-code` has an empty `cannot` — the door is silent, and that silence is the
    // regression contract of the live circuit.
    expect(kindLeverRefusal({ kind: CLAUDE_CODE, role: "dev-core", asks })).toBeUndefined();
    expect(kindLeverRefusal({ kind: CODEX, role: "dev-core", asks: [] })).toBeUndefined();
  });

  it("never matches the two levers no role can ask for", () => {
    // `quota-signal` and `quota-window` stand in CODEX.cannot for the human reading
    // `orchestrator status` — they are read out of a stream, not requested at a spawn,
    // so `leversAskedFor` has no field that could produce them and this door never fires
    // on them. That is the answer to the question left open in thread 026: a name in
    // `cannot` is a statement about the TOOL, a match here is one about a ROLE.
    expect(CODEX.cannot).toContain("quota-signal");
    expect(
      leversAskedFor({
        allowedTools: ["Bash"],
        denyRules: [],
      }).map((ask) => ask.lever),
    ).not.toContain("quota-signal");
  });
});

/**
 * THE INVARIANT OF THE REGISTRY (thread 026, statement of `2026-08-23T11-08-25Z`, point 3).
 *
 * Every assertion above this one is about an INSTANCE: this is what claude-code does,
 * this is what codex cannot. Those pin the two kinds that exist and say nothing about
 * the third, which is exactly where the contract is easiest to break — a kind added
 * with a `stream` missing `quotaSignalOf` and a `cannot` that forgot to say so is a
 * tool that answers "no limit was ever signalled" to gate 019, and answers it in the
 * voice of a measurement.
 *
 * So the claim here is quantified over `AGENT_KINDS` and it is an EQUIVALENCE, both
 * halves of it load-bearing:
 *
 *  - a name in `cannot` with a reader present would be a kind slandering itself — the
 *    shelf it could have built preventively is never built, and nothing says why;
 *  - a reader absent with nothing in `cannot` is the silent version of the same lie,
 *    and it is the one that reaches an operator as "your account has no limits".
 *
 * It passes today by construction (claude-code has both readers and an empty `cannot`;
 * codex has neither reader and names both). It exists to fail on the THIRD kind, the
 * day somebody writes half of it.
 */
describe("the invariant of the registry — quantified over every kind, not over two", () => {
  it.each(AGENT_KINDS.map((kind) => [kind.id, kind] as const))(
    "'%s' names 'quota-signal' in `cannot` exactly when its stream has no reader for one",
    (_id, kind) => {
      expect(kind.cannot.includes("quota-signal")).toBe(kind.stream.quotaSignalOf === undefined);
    },
  );

  it.each(AGENT_KINDS.map((kind) => [kind.id, kind] as const))(
    "'%s' names 'quota-window' in `cannot` exactly when its stream has no reader for one",
    (_id, kind) => {
      expect(kind.cannot.includes("quota-window")).toBe(kind.stream.windowBoundaryOf === undefined);
    },
  );

  it("registers every kind under its own id, and each id once", () => {
    // The join `kindOf` makes is what `--worker` and `agent.kind` both walk through; two
    // kinds sharing an id would make one of them unreachable in silence, and which one
    // would depend on the order of this array.
    for (const kind of AGENT_KINDS) expect(kindOf(kind.id)).toBe(kind);
    expect(new Set(AGENT_KINDS.map((kind) => kind.id)).size).toBe(AGENT_KINDS.length);
  });
});
