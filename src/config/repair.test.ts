/**
 * THE HEALER'S READ (thread 055, task 055.3) — the door asked "where does this box keep
 * its state" by the command that is about to bring the code to the config's version.
 *
 * Every case here is the SAME config: one that a NEWER package wrote. That is the only
 * situation this intent exists for, and the two halves of it are checked apart on
 * purpose — the number ahead, and a field this build has never heard of. The second is
 * why skipping the gate alone would not have closed the defect: a strict parse trips
 * over `Unrecognized key` before any number is compared (the lesson `tolerateOlder` was
 * deleted over).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { loadProtocolConfig } from "./load.js";
import { createSkewVoice, describeRepairSkew } from "./repair.js";

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: ".worktrees/comms", ref: "origin/main" },
  roles: [
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "PM" },
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "lle-dev-core" },
      summary: "main stream",
    },
  ],
};

const repoWith = (config: unknown): string => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-repair-"));
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(config, null, 2)}\n`);
  const git = (...args: string[]): void => {
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
      { encoding: "utf8" },
    );
  };
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "protocol config");
  return repo;
};

/** What a package one version behind the repository sees. */
const AHEAD = { ...CONFIG, protocolVersion: CURRENT_PROTOCOL_VERSION + 1 };

/** …and what it sees when the bump also ADDED a field, which is the usual case. */
const AHEAD_WITH_A_NEW_FIELD = {
  ...AHEAD,
  somethingTheNextVersionAdded: { whatever: true },
  orchestrator: { ...CONFIG.orchestrator, alsoNew: "beside the paths" },
};

describe("the repair intent reads a config that is ahead of this package", () => {
  it("answers with the two paths instead of refusing by the number", () => {
    const loaded = loadProtocolConfig({
      repo: repoWith(AHEAD),
      ref: "HEAD",
      fetch: false,
      intent: "repair",
    });

    expect(loaded.config.orchestrator?.state).toBe(".orchestrator");
    expect(loaded.config.mail.dir).toBe("agent-comms");
    expect(loaded.version.state).toBe("ahead");
  });

  it("and answers it through a field this build has never heard of", () => {
    // The half a gate-only exemption would have missed: the strict parse of the full
    // config dies on the unknown key BEFORE the version is compared.
    const loaded = loadProtocolConfig({
      repo: repoWith(AHEAD_WITH_A_NEW_FIELD),
      ref: "HEAD",
      fetch: false,
      intent: "repair",
    });

    expect(loaded.config.orchestrator?.mailCheckout).toBe(".worktrees/comms");
    expect(loaded.version.declared).toBe(CURRENT_PROTOCOL_VERSION + 1);
  });

  it("the SAME config still stops a data reader — the exemption is the question's, not the file's", () => {
    const repo = repoWith(AHEAD_WITH_A_NEW_FIELD);

    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow(
      /restart required/,
    );
  });

  it("refuses by the DATA when the field it came for is not there at all", () => {
    // The promise this shape does not make: a future version that MOVES `state` is a
    // manual event, and the refusal then names the field rather than the number.
    const repo = repoWith({ ...AHEAD, orchestrator: { mailCheckout: ".worktrees/comms" } });

    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false, intent: "repair" })).toThrow(
      /state/,
    );
  });
});

describe("the skew a healer says out loud", () => {
  it("names the two fields it read, so the claim is the narrow one", () => {
    const said = describeRepairSkew({
      ref: "origin/main",
      version: { state: "ahead", declared: 16, supported: 15 },
    });

    expect(said).toContain("declares protocol version 16");
    expect(said).toContain("orchestrator.state");
    expect(said).toContain("mail.dir");
  });

  it("says nothing when the shapes match — good news every frame hides the bad", () => {
    expect(
      describeRepairSkew({
        ref: "origin/main",
        version: { state: "current", declared: 16, supported: 16 },
      }),
    ).toBeUndefined();
  });
});

/**
 * ONE STATEMENT, ONE SENTENCE (the reviewer's finding on PR #202): `restart` asks the
 * healer's door three times in one command, and the operator got the same line three
 * times among the phases.
 */
describe("the voice that says the skew", () => {
  it("says the same statement once and the same one never again", () => {
    const voice = createSkewVoice();

    expect(voice.announce("repo\0origin/main\0agent-protocol.json", "version 16, writes 15")).toBe(
      true,
    );
    expect(voice.announce("repo\0origin/main\0agent-protocol.json", "version 16, writes 15")).toBe(
      false,
    );
  });

  it("says a CHANGED statement again — after the pull the repository can be elsewhere", () => {
    const voice = createSkewVoice();
    const key = "repo\0origin/main\0agent-protocol.json";
    voice.announce(key, "version 16, writes 15");

    // Phase 3 pulled; the same read now finds another number. That is news, not an echo.
    expect(voice.announce(key, "version 17, writes 15")).toBe(true);
  });

  it("keeps two refs apart — the key is the question, not the sentence alone", () => {
    const voice = createSkewVoice();
    voice.announce("repo\0origin/main\0agent-protocol.json", "version 16, writes 15");

    expect(voice.announce("repo\0HEAD\0agent-protocol.json", "version 16, writes 15")).toBe(true);
  });
});
