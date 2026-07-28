import { describe, expect, it } from "vitest";

import { IDENTITY_DOMAIN, identityEnv, ORCHESTRATOR_IDENTITY, roleIdentity } from "./identity.js";

describe("roleIdentity", () => {
  it("is the role id and an address in the protocol's domain", () => {
    expect(roleIdentity("dev-core")).toEqual({
      name: "dev-core",
      email: "dev-core@agents.invalid",
    });
  });

  it("uses a domain that cannot resolve — the addresses are read, never written to", () => {
    // RFC 2606 reserves `.invalid`, so nobody can register it and take agent mail.
    expect(IDENTITY_DOMAIN.endsWith(".invalid")).toBe(true);
  });

  it("keeps the machinery's own commits distinct from any role's", () => {
    // The instance digest is written by the daemon; signing it `curator` would claim a
    // turn nobody took.
    expect(ORCHESTRATOR_IDENTITY.email).not.toBe(roleIdentity("agent-protocol").email);
  });
});

describe("identityEnv", () => {
  it("sets committer as well as author — git falls back to the config for the one left out", () => {
    expect(identityEnv({ name: "curator", email: "curator@agents.invalid" })).toEqual({
      GIT_AUTHOR_NAME: "curator",
      GIT_AUTHOR_EMAIL: "curator@agents.invalid",
      GIT_COMMITTER_NAME: "curator",
      GIT_COMMITTER_EMAIL: "curator@agents.invalid",
    });
  });
});
