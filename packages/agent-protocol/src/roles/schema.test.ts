import { describe, expect, it } from "vitest";

import { protocolConfigSchema } from "../config/config.js";

const MAIL = { branch: "comms", dir: "agent-comms" };

const human = {
  id: "john",
  kind: "human",
  status: "active",
  wake: { mode: "self" },
  summary: "owner",
};

describe("protocolConfigSchema", () => {
  it("accepts a minimal config and by default grants a role no permissions", () => {
    const parsed = protocolConfigSchema.parse({ protocolVersion: 1, mail: MAIL, roles: [human] });

    expect(parsed.roles[0]?.permissions).toEqual([]);
  });

  it("rejects an unknown field instead of swallowing it", () => {
    // Otherwise a typo in a field name would mean a silent default — the very
    // class of quiet defects the package is being written for.
    const result = protocolConfigSchema.safeParse({
      protocolVersion: 1,
      mail: MAIL,
      roles: [{ ...human, sesion: "lle-john" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an id that would not survive parsing in waiting-on", () => {
    const result = protocolConfigSchema.safeParse({
      protocolVersion: 1,
      mail: MAIL,
      roles: [{ ...human, id: "Dev Core" }],
    });

    expect(result.success).toBe(false);
  });

  it("does not let a session be declared for a role nobody wakes", () => {
    const result = protocolConfigSchema.safeParse({
      protocolVersion: 1,
      mail: MAIL,
      roles: [{ ...human, wake: { mode: "self", session: "lle-john" } }],
    });

    expect(result.success).toBe(false);
  });

  it("requires session for a role on watch and via for a role coming alive through a human", () => {
    const noSession = protocolConfigSchema.safeParse({
      protocolVersion: 1,
      mail: MAIL,
      roles: [{ ...human, id: "dev-core", wake: { mode: "watch" } }],
    });
    const noVia = protocolConfigSchema.safeParse({
      protocolVersion: 1,
      mail: MAIL,
      roles: [{ ...human, id: "curator", wake: { mode: "via-human" } }],
    });

    expect(noSession.success).toBe(false);
    expect(noVia.success).toBe(false);
  });

  it("rejects a config of an unknown format version", () => {
    const result = protocolConfigSchema.safeParse({ version: 2, mail: MAIL, roles: [human] });

    expect(result.success).toBe(false);
  });
});

describe("launch.limits — the run ceilings of one role (R12)", () => {
  const withLaunch = (launch: unknown) =>
    protocolConfigSchema.safeParse({
      protocolVersion: 1,
      mail: MAIL,
      roles: [{ ...human, id: "dev-core", wake: { mode: "watch", session: "s" }, launch }],
    });

  it("accepts the three ceilings beside the tools", () => {
    const result = withLaunch({
      allowedTools: ["Bash"],
      limits: { idleSeconds: 600, wallClockSeconds: 3600, maxTurns: 300 },
    });

    expect(result.success).toBe(true);
    expect(result.data?.roles[0]?.launch?.limits?.maxTurns).toBe(300);
  });

  it("every field is optional, and so is the block: silence falls through to the package default", () => {
    expect(withLaunch({ allowedTools: ["Bash"] }).success).toBe(true);
    expect(withLaunch({ allowedTools: ["Bash"], limits: { maxTurns: 60 } }).success).toBe(true);
  });

  it("idleSeconds: 0 is legal — it is the detector switched off, the same as --idle 0", () => {
    expect(withLaunch({ allowedTools: ["Bash"], limits: { idleSeconds: 0 } }).success).toBe(true);
  });

  it("a zero wall clock or zero turns is a MISTAKE, not 'off': a window of nothing", () => {
    expect(withLaunch({ allowedTools: ["Bash"], limits: { wallClockSeconds: 0 } }).success).toBe(
      false,
    );
    expect(withLaunch({ allowedTools: ["Bash"], limits: { maxTurns: 0 } }).success).toBe(false);
  });

  it("a misspelled ceiling is refused, not silently defaulted", () => {
    // The rule of the whole config: a typo in a field name must not become a quiet
    // default. Here it would be a run with ceilings nobody set.
    expect(withLaunch({ allowedTools: ["Bash"], limits: { maxTurn: 60 } }).success).toBe(false);
  });

  it("seconds are seconds: a fractional ceiling is refused", () => {
    expect(withLaunch({ allowedTools: ["Bash"], limits: { wallClockSeconds: 1.5 } }).success).toBe(
      false,
    );
  });
});

describe("launch.agent — which tool raises the role, and with what (R15)", () => {
  const withLaunch = (launch: unknown) =>
    protocolConfigSchema.safeParse({
      protocolVersion: 1,
      mail: MAIL,
      roles: [{ ...human, id: "dev-core", wake: { mode: "watch", session: "s" }, launch }],
    });

  it("accepts the tool and its parameters beside the tools and the ceilings", () => {
    const result = withLaunch({
      allowedTools: ["Bash"],
      agent: { kind: "claude-code", model: "opus", effort: "high" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.roles[0]?.launch?.agent).toEqual({
      kind: "claude-code",
      model: "opus",
      effort: "high",
    });
  });

  it("the block is optional, and so is every parameter in it", () => {
    expect(withLaunch({ allowedTools: ["Bash"] }).success).toBe(true);
    expect(withLaunch({ allowedTools: ["Bash"], agent: { kind: "claude-code" } }).success).toBe(
      true,
    );
  });

  it("REFUSES an effort level the tool does not have", () => {
    // The vocabulary is `claude-code`'s own (`--effort`), and it is knowable in
    // advance — so a value outside it is caught by the config's own door rather
    // than by the agent, five seconds into a run that has already taken a lease.
    expect(
      withLaunch({ allowedTools: ["Bash"], agent: { kind: "claude-code", effort: "extreme" } })
        .success,
    ).toBe(false);
  });

  it("REFUSES a parameter the named tool does not understand", () => {
    // The reason for keying the block on the tool: parameters belong to the tool,
    // and a field silently dropped here is a run that cost money with settings
    // nobody chose.
    expect(
      withLaunch({ allowedTools: ["Bash"], agent: { kind: "claude-code", temperature: 0.7 } })
        .success,
    ).toBe(false);
  });

  it("REFUSES a tool the package cannot raise — the union names the ones it can", () => {
    // Honest about the boundary with R8: the general shape of "parameters of any
    // connector" is not built here, so an unknown tool is refused rather than
    // accepted with parameters nobody can pass.
    expect(withLaunch({ allowedTools: ["Bash"], agent: { kind: "cursor" } }).success).toBe(false);
  });

  it("accepts the SECOND tool the package implements, and its model (thread 026)", () => {
    // Until #71 the schema had one member and that was true of the package too. It
    // stopped being true, and a card that could not name a tool the orchestrator can
    // raise left `--worker` as the only way in — a flag decides one run, a card decides
    // the role.
    const result = withLaunch({
      allowedTools: ["Bash"],
      agent: { kind: "codex", model: "gpt-5-codex" },
    });
    expect(result.success).toBe(true);
    expect(result.data?.roles[0]?.launch?.agent).toEqual({ kind: "codex", model: "gpt-5-codex" });
  });

  it("REFUSES `effort` on codex BY THE KEY — the vocabulary is not decided yet", () => {
    // Codex HAS the lever (`-c model_reasoning_effort=`), which is why it is absent
    // from `CODEX_CANNOT`. What its levels are, and whether this package validates
    // them or hands the string to the vendor, is a question about the form of the
    // config (R14) and stands in thread 026. Refused by the strict object until it is
    // answered — an accepted field nobody validates would decide runs in silence.
    expect(
      withLaunch({ allowedTools: ["Bash"], agent: { kind: "codex", effort: "high" } }).success,
    ).toBe(false);
    // And the other vendor's parameters do not leak in through the second member either.
    expect(
      withLaunch({ allowedTools: ["Bash"], agent: { kind: "codex", temperature: 0.7 } }).success,
    ).toBe(false);
  });

  it("the tool must be NAMED: parameters with no owner are not a shape we accept", () => {
    expect(withLaunch({ allowedTools: ["Bash"], agent: { model: "opus" } }).success).toBe(false);
  });
});
