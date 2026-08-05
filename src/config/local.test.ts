/**
 * The MACHINE config (R14). What is tested here is the BOUNDARY, not the parsing:
 * the file exists so that one class of knowledge — where the binaries are — stops
 * living in a shell history, and the whole value of it depends on the other class —
 * policy — never leaking in.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeLocalConfig,
  LocalConfigError,
  loadLocalConfig,
  localConfigPath,
  parseLocalConfig,
  resolveLocalConfig,
} from "./local.js";

const withFile = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "agent-protocol-local-"));
  const path = join(dir, "local.json");
  writeFileSync(path, content, "utf8");
  return path;
};

describe("where the machine config lies", () => {
  it("honours XDG_CONFIG_HOME", () => {
    expect(localConfigPath({ XDG_CONFIG_HOME: "/x/cfg" })).toBe("/x/cfg/agent-protocol/local.json");
  });

  it("falls back to ~/.config", () => {
    expect(localConfigPath({ HOME: "/home/j" })).toBe("/home/j/.config/agent-protocol/local.json");
  });
});

describe("the boundary: the machine says WHERE, never WHAT", () => {
  it("a binary per tool is what it is for", () => {
    const config = parseLocalConfig({ agents: { "claude-code": { exec: "/opt/claude" } } }, "p");
    expect(config.agents["claude-code"]?.exec).toBe("/opt/claude");
  });

  it("POLICY in the machine config is refused, and the refusal names the rule", () => {
    // The whole point of the split. A box quietly running with ceilings or
    // permissions nobody reviewed is precisely what moving the config into `main`
    // was meant to make impossible; a second file that accepts them would undo it.
    for (const key of ["limits", "allowedTools", "roles", "workdir", "permissions"]) {
      expect(() => parseLocalConfig({ [key]: {} }, "p")).toThrow(LocalConfigError);
      expect(() => parseLocalConfig({ [key]: {} }, "p")).toThrow(/POLICY/);
    }
  });

  it("an unknown field is refused too — a typo must not become a silent default", () => {
    expect(() => parseLocalConfig({ agents: {}, colour: "red" }, "p")).toThrow(LocalConfigError);
  });

  it("an unknown field INSIDE an agent is refused: the tool's settings are not location", () => {
    // `model` looks like it belongs beside the binary and does not: it decides what
    // the work is, so it lives in the repository, behind a PR.
    expect(() =>
      parseLocalConfig({ agents: { "claude-code": { exec: "c", model: "opus" } } }, "p"),
    ).toThrow(LocalConfigError);
  });

  it("no agents at all is a valid file", () => {
    expect(parseLocalConfig({}, "p").agents).toEqual({});
  });
});

describe("reading it", () => {
  it("an ABSENT default file is not an error — a machine with the agent on PATH says nothing", () => {
    const loaded = loadLocalConfig({ env: { XDG_CONFIG_HOME: "/nowhere-at-all" } });
    expect(loaded).toMatchObject({ found: false, explicit: false });
    expect(loaded.config.agents).toEqual({});
  });

  it("a NAMED file that is missing IS an error — the operator pointed at it", () => {
    // The difference is the whole of it: a silent fallback to defaults after an
    // explicit `--local-config` is how a run ends up using settings nobody chose.
    expect(() => loadLocalConfig({ path: "/nowhere-at-all/local.json" })).toThrow(LocalConfigError);
  });

  it("malformed JSON is loud, not empty", () => {
    expect(() => loadLocalConfig({ path: withFile("{oops") })).toThrow(/is not JSON/);
  });

  it("reads a real file", () => {
    const path = withFile('{"agents":{"claude-code":{"exec":"/opt/claude"}}}');
    expect(loadLocalConfig({ path })).toMatchObject({ found: true, explicit: true });
  });
});

describe("what a human is shown", () => {
  it("an absent file says where it would have been AND what happens instead", () => {
    const line = describeLocalConfig({
      config: { agents: {} },
      path: "/home/j/.config/agent-protocol/local.json",
      found: false,
      explicit: false,
    });
    expect(line).toContain("/home/j/.config/agent-protocol/local.json");
    expect(line).toContain("PATH");
  });

  it("a present file lists the mapping — the answer to 'which binary did it start'", () => {
    const line = describeLocalConfig({
      config: { agents: { "claude-code": { exec: "/opt/claude" } } },
      path: "/x/local.json",
      found: true,
      explicit: false,
    });
    expect(line).toContain("claude-code → /opt/claude");
  });

  it("names the operator — a hold carries that signature, so it is shown where it comes from", () => {
    const line = describeLocalConfig({
      config: { agents: {}, operator: "john" },
      path: "/x/local.json",
      found: true,
      explicit: false,
    });
    expect(line).toContain("operator john");
  });
});

describe("who sits at this box (thread 019)", () => {
  it("'operator' is accepted — WHICH of the roles is here is a fact about the machine", () => {
    expect(parseLocalConfig({ operator: "john" }, "p").operator).toBe("john");
  });

  it("is optional — a box that never parks anything says nothing", () => {
    expect(parseLocalConfig({ agents: {} }, "p").operator).toBeUndefined();
  });

  it("the PLURAL is still policy — 'roles' names the rule, not the typo", () => {
    // The symmetry with `instance`/`instances`: identity may live here, the register
    // of who exists may not.
    expect(() => parseLocalConfig({ operator: "john", roles: [] }, "p")).toThrow(/POLICY/);
  });
});

/**
 * THE BOX THAT HOSTS SEVERAL PROJECTS (thread `055-multi-instance-multi-account`).
 * What is tested here is the RESOLUTION and its refusals, not the parsing: the value
 * of three layers is that every answer has a source and no two layers may disagree
 * silently — a quiet pick would raise one project's roles with another's binaries.
 */
describe("which instance's machine config a command is about", () => {
  const box = (files: Readonly<Record<string, unknown>>, unnamed?: unknown): NodeJS.ProcessEnv => {
    const home = mkdtempSync(join(tmpdir(), "agent-protocol-box-"));
    const dir = join(home, "agent-protocol", "instances");
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(
        join(dir, `${name}.json`),
        typeof content === "string" ? content : JSON.stringify(content),
        "utf8",
      );
    }
    if (unnamed !== undefined) {
      writeFileSync(join(home, "agent-protocol", "local.json"), JSON.stringify(unnamed), "utf8");
    }
    return { XDG_CONFIG_HOME: home };
  };

  it("a box with no named configs behaves exactly as it did before", () => {
    // A.5 of the statement: the one-instance machine must not learn a new word.
    const env = box({}, { agents: { "claude-code": { exec: "/opt/a" } } });
    const resolved = resolveLocalConfig({ env, repo: "/srv/whatever" });
    expect(resolved.source).toBe("default");
    expect(resolved.instanceName).toBeUndefined();
    expect(resolved.config.agents["claude-code"]?.exec).toBe("/opt/a");
  });

  it("the checkout answers on its own — that is the layer that removes the ceremony", () => {
    const env = box({
      lle: { repo: "/srv/lle", agents: { "claude-code": { exec: "/opt/lle" } } },
      crew: { repo: "/srv/crew", agents: { "claude-code": { exec: "/opt/crew" } } },
    });
    const resolved = resolveLocalConfig({ env, repo: "/srv/crew" });
    expect(resolved.instanceName).toBe("crew");
    expect(resolved.source).toBe("checkout");
    expect(resolved.config.agents["claude-code"]?.exec).toBe("/opt/crew");
    expect(resolved.resolution).toContain("crew");
  });

  it("a role's worktree answers with the instance of its home checkout", () => {
    const env = box({ lle: { repo: "/srv/lle" } });
    expect(resolveLocalConfig({ env, repo: "/srv/lle/.worktrees/dev-core" }).instanceName).toBe(
      "lle",
    );
  });

  it("the flag wins over the checkout when they agree, and SAYS which layer answered", () => {
    const env = box({ lle: { repo: "/srv/lle" } });
    const resolved = resolveLocalConfig({ env, repo: "/srv/lle", instance: "lle" });
    expect(resolved.source).toBe("flag");
    expect(resolved.resolution).toContain("--instance");
  });

  it("the env is the middle layer and names itself in the resolution", () => {
    const env = { ...box({ crew: { repo: "/srv/crew" } }), AGENT_PROTOCOL_INSTANCE: "crew" };
    const resolved = resolveLocalConfig({ env, repo: "/elsewhere" });
    expect(resolved.source).toBe("env");
    expect(resolved.resolution).toContain("AGENT_PROTOCOL_INSTANCE");
  });

  it("a NAME that disagrees with the checkout is refused by name, not picked quietly", () => {
    // The failure this shape exists to prevent: one project's roles raised with
    // another project's binaries, with nothing anywhere saying why.
    const env = box({ lle: { repo: "/srv/lle" }, crew: { repo: "/srv/crew" } });
    expect(() => resolveLocalConfig({ env, repo: "/srv/lle", instance: "crew" })).toThrow(
      LocalConfigError,
    );
    expect(() => resolveLocalConfig({ env, repo: "/srv/lle", instance: "crew" })).toThrow(
      /'crew'.*'lle'|'lle'.*'crew'/s,
    );
  });

  it("two instances claiming the same checkout are a refusal — the box cannot know", () => {
    const env = box({ a: { repo: "/srv/lle" }, b: { repo: "/srv/lle" } });
    expect(() => resolveLocalConfig({ env, repo: "/srv/lle" })).toThrow(/--instance/);
  });

  it("nested checkouts: the LONGER claim wins, being the more specific answer", () => {
    const env = box({ outer: { repo: "/srv" }, inner: { repo: "/srv/lle" } });
    expect(resolveLocalConfig({ env, repo: "/srv/lle/apps" }).instanceName).toBe("inner");
  });

  it("an unclaimed checkout on a box with named configs and no local.json is refused", () => {
    // Proceeding would mean running with defaults nobody chose.
    const env = box({ lle: { repo: "/srv/lle" } });
    expect(() => resolveLocalConfig({ env, repo: "/srv/other" })).toThrow(/name the instance/);
  });

  it("…but an unclaimed checkout falls back to local.json where there is one", () => {
    const env = box({ lle: { repo: "/srv/lle" } }, { agents: {} });
    const resolved = resolveLocalConfig({ env, repo: "/srv/other" });
    expect(resolved.source).toBe("default");
    expect(resolved.resolution).toContain("lle");
  });

  it("a named file that is not JSON is SKIPPED and named — one broken sibling blinds nobody", () => {
    const env = box({ broken: "{ not json", lle: { repo: "/srv/lle" } });
    const resolved = resolveLocalConfig({ env, repo: "/srv/lle" });
    expect(resolved.instanceName).toBe("lle");
    expect(resolved.resolution).toContain("broken");
  });

  it("a named instance that has no file is a refusal — the operator pointed at one", () => {
    const env = box({ lle: { repo: "/srv/lle" } });
    expect(() => resolveLocalConfig({ env, repo: "/srv/lle", instance: "ghost" })).toThrow(
      LocalConfigError,
    );
  });

  it("--local-config still names a path outright and skips the question", () => {
    const env = box({ lle: { repo: "/srv/lle" } });
    const path = withFile(JSON.stringify({ agents: { "claude-code": { exec: "/opt/x" } } }));
    const resolved = resolveLocalConfig({ env, repo: "/srv/lle", path });
    expect(resolved.source).toBe("path");
    expect(resolved.instanceName).toBeUndefined();
    expect(resolved.config.agents["claude-code"]?.exec).toBe("/opt/x");
  });

  it("the instance is named FIRST in the description — 'which project is this'", () => {
    const env = box({ crew: { repo: "/srv/crew", operator: "john" } });
    expect(describeLocalConfig(resolveLocalConfig({ env, repo: "/srv/crew" }))).toMatch(
      /^instance 'crew' · /,
    );
  });

  it("'repo' is location, not policy — the machine may say where its checkout is", () => {
    expect(parseLocalConfig({ repo: "/srv/lle" }, "p").repo).toBe("/srv/lle");
  });
});
