import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadProtocolConfig } from "./load.js";

const CONFIG = {
  version: 1,
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

    writeFileSync(path, JSON.stringify({ version: 1, roles: CONFIG.roles }));
    commit("no mail section");
    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow(/mail/);
  });

  it("fails on a non-existent ref instead of staying silent", () => {
    const { repo } = repoWithConfig();

    expect(() => loadProtocolConfig({ repo, ref: "no-such-ref", fetch: false })).toThrow();
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
