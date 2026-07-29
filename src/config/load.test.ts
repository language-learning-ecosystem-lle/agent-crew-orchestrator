import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { loadProtocolConfig } from "./load.js";

// A VALID config is pinned to the version the package writes now, not to a
// literal: a bump must not turn every fixture here into a stale one.
const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [
    { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "PM" },
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "lle-dev-core" },
      summary: "main stream",
      permissions: ["thread-status"],
    },
  ],
};

const repoWithConfig = (): { repo: string; path: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-config-"));
  const path = join(repo, "agent-protocol.json");
  writeFileSync(path, `${JSON.stringify(CONFIG, null, 2)}\n`);

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

  return { repo, path };
};

describe("loadProtocolConfig", () => {
  it("reads the config at the given ref and builds the role registry", () => {
    const { repo } = repoWithConfig();

    const loaded = loadProtocolConfig({ repo, ref: "HEAD", fetch: false });

    expect(loaded.registry.ids()).toEqual(["john", "dev-core"]);
    expect(loaded.config.mail).toEqual({ branch: "comms", dir: "agent-comms" });
    expect(loaded.registry.canEditThreadStatus("dev-core")).toBe(true);
  });

  it("does NOT see an edit in the working copy — only what is committed at the ref", () => {
    // This is why the config is read through git: an agent's worktree sits on the
    // agent's own branch, and the permissions it wrote for itself there must not
    // look effective to the circuit.
    const { repo, path } = repoWithConfig();
    writeFileSync(
      path,
      JSON.stringify({
        ...CONFIG,
        roles: [
          ...CONFIG.roles,
          {
            id: "impostor",
            kind: "claude-code",
            status: "active",
            wake: { mode: "event" },
            summary: "granted itself a role in the working copy",
          },
        ],
      }),
    );

    const loaded = loadProtocolConfig({ repo, ref: "HEAD", fetch: false });

    expect(loaded.registry.isKnown("impostor")).toBe(false);
  });

  it("fails with a list of complaints on malformed JSON and on an invalid config", () => {
    const { repo, path } = repoWithConfig();
    const commit = (message: string): void => {
      execFileSync(
        "git",
        [
          "-C",
          repo,
          "-c",
          "user.name=test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "-qam",
          message,
        ],
        { encoding: "utf8" },
      );
    };

    writeFileSync(path, "{not json");
    commit("malformed json");
    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow(/not JSON/);

    writeFileSync(
      path,
      JSON.stringify({ protocolVersion: CURRENT_PROTOCOL_VERSION, roles: CONFIG.roles }),
    );
    commit("no mail section");
    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow(/mail/);
  });

  it("fails on a non-existent ref instead of staying silent", () => {
    const { repo } = repoWithConfig();

    expect(() => loadProtocolConfig({ repo, ref: "no-such-ref", fetch: false })).toThrow();
  });
});

describe("the protocol version gate", () => {
  const commitConfig = (repo: string, path: string, config: unknown): void => {
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qam", "config"],
      { encoding: "utf8" },
    );
  };

  it("stops the circuit when the repository is at another version than the package", () => {
    // Deliberately a HALT and not a warning: reading data of one shape with the
    // rules of another is the class of quiet defect this package is written for.
    const { repo, path } = repoWithConfig();
    commitConfig(repo, path, { ...CONFIG, protocolVersion: 99 });

    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow(
      /protocol version 99/,
    );
  });

  it("meets a config that predates versioning with the exact repair", () => {
    // The field was RENAMED, not removed, and a strict-object complaint about an
    // unknown 'version' is true and useless.
    const { repo, path } = repoWithConfig();
    const { protocolVersion: _dropped, ...withoutVersion } = CONFIG;
    commitConfig(repo, path, { version: 1, ...withoutVersion });

    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow(
      /rename it to 'protocolVersion'/,
    );
  });

  it("lets a reader through DOWNWARDS when it asks to (`tolerateOlder`), and says so in the verdict", () => {
    // The one reader that needs this is `zones check`: it points at the BASE of a
    // pull request on purpose, so a PR bumping the version reads a config that is
    // behind BY CONSTRUCTION. The policy it asks for does not depend on the number.
    const { repo, path } = repoWithConfig();
    commitConfig(repo, path, { ...CONFIG, protocolVersion: CURRENT_PROTOCOL_VERSION - 1 });

    const loaded = loadProtocolConfig({ repo, ref: "HEAD", fetch: false, tolerateOlder: true });

    expect(loaded.version).toEqual({
      state: "behind",
      declared: CURRENT_PROTOCOL_VERSION - 1,
      supported: CURRENT_PROTOCOL_VERSION,
    });
    expect(loaded.registry.ids()).toEqual(["john", "dev-core"]);
  });

  it("does NOT let the same reader through UPWARDS — a config newer than the package still halts", () => {
    // Asymmetric on purpose: older data can be read by newer rules, data written by
    // a shape this package has never seen cannot be guessed at.
    const { repo, path } = repoWithConfig();
    commitConfig(repo, path, { ...CONFIG, protocolVersion: CURRENT_PROTOCOL_VERSION + 1 });

    expect(() =>
      loadProtocolConfig({ repo, ref: "HEAD", fetch: false, tolerateOlder: true }),
    ).toThrow(/supports only/);
  });

  it("a config AHEAD of the package is diagnosed by VERSION even when it carries fields this build never heard of", () => {
    // The failure of 2026-07-28 verbatim (thread `023-daemon-parallelism`): a daemon
    // raised before the merge that bumped the shape met the new key and died on
    // `Unrecognized key`, taking every command with it — `status` included. The
    // strict object is right and useless here; the version is the one fact that
    // names the repair, so it is asked of the RAW file before the parse.
    const { repo, path } = repoWithConfig();
    commitConfig(repo, path, {
      ...CONFIG,
      protocolVersion: CURRENT_PROTOCOL_VERSION + 1,
      whatTheNewerPackageAdded: { stalled: true },
    });

    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow(
      /restart required/,
    );
    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).not.toThrow(
      /Unrecognized key/,
    );
  });

  it("a config BEHIND the package still goes through the parse — `tolerateOlder` needs its data", () => {
    // The pre-gate is deliberately one-directional: `behind` is a shape this package
    // can still describe, and door 3 of thread 020 READS it (`zones check` on the base
    // of a PR that bumps the version). Gating it early would take the data away from
    // the one reader entitled to it.
    const { repo, path } = repoWithConfig();
    commitConfig(repo, path, { ...CONFIG, protocolVersion: CURRENT_PROTOCOL_VERSION - 1 });

    expect(
      loadProtocolConfig({ repo, ref: "HEAD", fetch: false, tolerateOlder: true }).registry.ids(),
    ).toEqual(["john", "dev-core"]);
  });

  it("keeps the halt for every other reader — tolerance is asked for, never assumed", () => {
    const { repo, path } = repoWithConfig();
    commitConfig(repo, path, { ...CONFIG, protocolVersion: CURRENT_PROTOCOL_VERSION - 1 });

    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow(
      /run 'agent-protocol schema migrate'/,
    );
  });
});

describe("the orchestrator section", () => {
  it("is optional — a repository that only carries mail is legitimate", () => {
    const { repo } = repoWithConfig();
    expect(loadProtocolConfig({ repo, ref: "HEAD", fetch: false }).config.orchestrator).toBe(
      undefined,
    );
  });

  it("is read in full when declared", () => {
    const { repo, path } = repoWithConfig();
    const withOrchestrator = {
      ...CONFIG,
      orchestrator: {
        state: ".orchestrator",
        mailCheckout: ".worktrees/comms",
        ref: "origin/main",
      },
    };
    writeFileSync(path, `${JSON.stringify(withOrchestrator, null, 2)}\n`);
    execFileSync("git", [
      "-C",
      repo,
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qam",
      "orchestrator section",
    ]);

    expect(loadProtocolConfig({ repo, ref: "HEAD", fetch: false }).config.orchestrator).toEqual({
      state: ".orchestrator",
      mailCheckout: ".worktrees/comms",
      ref: "origin/main",
    });
  });

  it("rejects an unknown field loudly instead of silently ignoring it", () => {
    const { repo, path } = repoWithConfig();
    writeFileSync(
      path,
      `${JSON.stringify({ ...CONFIG, orchestrator: { state: ".o", mailCheckout: ".w", ref: "origin/main", journal: "foreign" } }, null, 2)}\n`,
    );
    execFileSync("git", [
      "-C",
      repo,
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qam",
      "unknown field",
    ]);

    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow();
  });
});

describe("the workspaces of the roles (R17)", () => {
  const withWorkdir = (workdir: unknown): unknown => ({
    ...CONFIG,
    orchestrator: {
      state: ".orchestrator",
      mailCheckout: ".worktrees/comms",
      ref: "origin/main",
      workdir,
    },
  });

  const commit = (repo: string, path: string, config: unknown): void => {
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    execFileSync("git", [
      "-C",
      repo,
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qam",
      "workdir",
    ]);
  };

  it("'worktrees' is optional: a repository saying nothing keeps the pre-R17 behaviour", () => {
    const { repo, path } = repoWithConfig();
    commit(repo, path, withWorkdir({ branch: "main" }));

    expect(
      loadProtocolConfig({ repo, ref: "HEAD", fetch: false }).config.orchestrator?.workdir,
    ).toEqual({ branch: "main" });
  });

  it("declared, it is read as the directory the per-role worktrees live in", () => {
    const { repo, path } = repoWithConfig();
    commit(repo, path, withWorkdir({ branch: "main", worktrees: ".worktrees" }));

    expect(
      loadProtocolConfig({ repo, ref: "HEAD", fetch: false }).config.orchestrator?.workdir,
    ).toEqual({ branch: "main", worktrees: ".worktrees" });
  });

  it("the base branch stays REQUIRED — worktrees with nothing to be based on is meaningless", () => {
    const { repo, path } = repoWithConfig();
    commit(repo, path, withWorkdir({ worktrees: ".worktrees" }));

    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow();
  });
});
