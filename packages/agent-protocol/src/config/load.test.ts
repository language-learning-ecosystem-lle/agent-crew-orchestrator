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
    { id: "john", kind: "человек", status: "active", wake: { mode: "self" }, summary: "PM" },
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "lle-dev-core" },
      summary: "поток",
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
  git("commit", "-q", "-m", "конфиг протокола");

  return { repo, path };
};

describe("loadProtocolConfig", () => {
  it("читает конфиг на указанном ref и строит реестр ролей", () => {
    const { repo } = repoWithConfig();

    const loaded = loadProtocolConfig({ repo, ref: "HEAD", fetch: false });

    expect(loaded.registry.ids()).toEqual(["john", "dev-core"]);
    expect(loaded.config.mail).toEqual({ branch: "comms", dir: "agent-comms" });
    expect(loaded.registry.canEditThreadStatus("dev-core")).toBe(true);
  });

  it("НЕ видит правку в рабочей копии — только закоммиченное на ref", () => {
    // Ради этого конфиг и читается через git: worktree агента стоит на его же
    // ветке, и права, которые он себе там дописал, не должны выглядеть
    // действующими для контура.
    const { repo, path } = repoWithConfig();
    writeFileSync(
      path,
      JSON.stringify({
        ...CONFIG,
        roles: [
          ...CONFIG.roles,
          {
            id: "самозванец",
            kind: "claude-code",
            status: "active",
            wake: { mode: "event" },
            summary: "дописал себе роль в рабочей копии",
          },
        ],
      }),
    );

    const loaded = loadProtocolConfig({ repo, ref: "HEAD", fetch: false });

    expect(loaded.registry.isKnown("самозванец")).toBe(false);
  });

  it("на кривом JSON и на невалидном конфиге падает с перечнем претензий", () => {
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

    writeFileSync(path, "{не json");
    commit("кривой json");
    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow(/не JSON/);

    writeFileSync(path, JSON.stringify({ version: 1, roles: CONFIG.roles }));
    commit("без секции mail");
    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow(/mail/);
  });

  it("на несуществующем ref падает, а не молчит", () => {
    const { repo } = repoWithConfig();

    expect(() => loadProtocolConfig({ repo, ref: "no-such-ref", fetch: false })).toThrow();
  });
});

describe("секция orchestrator", () => {
  it("необязательна — репозиторий, который возит только почту, законен", () => {
    const { repo } = repoWithConfig();
    expect(loadProtocolConfig({ repo, ref: "HEAD", fetch: false }).config.orchestrator).toBe(
      undefined,
    );
  });

  it("читается целиком, когда объявлена", () => {
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
      "секция оркестратора",
    ]);

    expect(loadProtocolConfig({ repo, ref: "HEAD", fetch: false }).config.orchestrator).toEqual({
      state: ".orchestrator",
      mailCheckout: ".worktrees/comms",
      ref: "origin/main",
    });
  });

  it("лишнее поле — громкий отказ, а не молча проигнорированное умолчание", () => {
    const { repo, path } = repoWithConfig();
    writeFileSync(
      path,
      `${JSON.stringify({ ...CONFIG, orchestrator: { state: ".o", mailCheckout: ".w", ref: "origin/main", journal: "чужое" } }, null, 2)}\n`,
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
      "лишнее поле",
    ]);

    expect(() => loadProtocolConfig({ repo, ref: "HEAD", fetch: false })).toThrow();
  });
});
