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
