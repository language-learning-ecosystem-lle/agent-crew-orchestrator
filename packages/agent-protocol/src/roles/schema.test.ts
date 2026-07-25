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
    const parsed = protocolConfigSchema.parse({ version: 1, mail: MAIL, roles: [human] });

    expect(parsed.roles[0]?.permissions).toEqual([]);
  });

  it("rejects an unknown field instead of swallowing it", () => {
    // Otherwise a typo in a field name would mean a silent default — the very
    // class of quiet defects the package is being written for.
    const result = protocolConfigSchema.safeParse({
      version: 1,
      mail: MAIL,
      roles: [{ ...human, sesion: "lle-john" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an id that would not survive parsing in waiting-on", () => {
    const result = protocolConfigSchema.safeParse({
      version: 1,
      mail: MAIL,
      roles: [{ ...human, id: "Dev Core" }],
    });

    expect(result.success).toBe(false);
  });

  it("does not let a session be declared for a role nobody wakes", () => {
    const result = protocolConfigSchema.safeParse({
      version: 1,
      mail: MAIL,
      roles: [{ ...human, wake: { mode: "self", session: "lle-john" } }],
    });

    expect(result.success).toBe(false);
  });

  it("requires session for a role on watch and via for a role coming alive through a human", () => {
    const noSession = protocolConfigSchema.safeParse({
      version: 1,
      mail: MAIL,
      roles: [{ ...human, id: "dev-core", wake: { mode: "watch" } }],
    });
    const noVia = protocolConfigSchema.safeParse({
      version: 1,
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
