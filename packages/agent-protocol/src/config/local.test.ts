/**
 * The MACHINE config (R14). What is tested here is the BOUNDARY, not the parsing:
 * the file exists so that one class of knowledge — where the binaries are — stops
 * living in a shell history, and the whole value of it depends on the other class —
 * policy — never leaking in.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeLocalConfig,
  LocalConfigError,
  loadLocalConfig,
  localConfigPath,
  parseLocalConfig,
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
