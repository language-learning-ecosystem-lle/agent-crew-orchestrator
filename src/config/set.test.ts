import { describe, expect, it } from "vitest";

import type { LocalConfig } from "./local.js";
import { configSetSummary, planConfigSet } from "./set.js";

const base = {
  path: "/home/op/.config/agent-protocol/local.json",
  declaredInstances: ["laptop", "lle-agents"],
  knownRoles: ["curator", "dev-core", "dev-speech"],
} as const;

const empty: LocalConfig = { agents: {} };

const plan = (over: Partial<Parameters<typeof planConfigSet>[0]>) =>
  planConfigSet({ current: empty, ...base, ...over });

const ok = (outcome: ReturnType<typeof planConfigSet>) => {
  if (!outcome.ok) throw new Error(`expected a plan, got a refusal: ${outcome.refusal}`);
  return outcome;
};

const refusal = (outcome: ReturnType<typeof planConfigSet>): string => {
  if (outcome.ok) throw new Error(`expected a refusal, got a plan for '${outcome.step.name}'`);
  return outcome.refusal;
};

describe("planConfigSet — what it writes", () => {
  it("names an instance a box did not have", () => {
    const result = ok(plan({ key: "instance", value: "lle-agents" }));
    expect(result.step.action).toBe("set");
    expect(result.next.instance).toBe("lle-agents");
  });

  it("prints BOTH SIDES of a change — the destructive one is never a one-word answer", () => {
    const result = ok(
      plan({ current: { agents: {}, instance: "laptop" }, key: "instance", value: "lle-agents" }),
    );
    expect(result.step.action).toBe("change");
    expect(result.step.detail).toContain("'laptop' → 'lle-agents'");
  });

  it("a value already there is a 'keep', so nothing is rewritten", () => {
    const result = ok(
      plan({ current: { agents: {}, instance: "laptop" }, key: "instance", value: "laptop" }),
    );
    expect(result.step.action).toBe("keep");
    expect(configSetSummary({ step: result.step, write: true, path: base.path })).toContain(
      "already says that",
    );
  });

  it("warns about an instance the repository does not declare — a bench raises nobody", () => {
    const result = ok(plan({ key: "instance", value: "somebody-elses-box" }));
    expect(result.step.detail).toContain("bench");
  });

  it("warns about an operator that is no role — a hold signed by it is refused", () => {
    const result = ok(plan({ key: "operator", value: "cosysoft" }));
    expect(result.step.detail).toContain("no role of this project");
    expect(result.next.operator).toBe("cosysoft");
  });

  it("records where the secrets file lies and says it is not there yet", () => {
    const result = ok(
      plan({ key: "secrets", value: "/etc/agent/secrets.env", secretsExists: false }),
    );
    expect(result.next.secrets).toEqual({ envFile: "/etc/agent/secrets.env" });
    expect(result.step.detail).toContain("not there yet");
  });

  it("sets one agent's binary and leaves the other tools alone", () => {
    const result = ok(
      plan({
        current: { agents: { "claude-code": { exec: "/old/claude" }, cursor: { exec: "/c" } } },
        key: "agent",
        value: "claude-code",
        exec: "/new/claude",
        execFound: true,
      }),
    );
    expect(result.next.agents).toEqual({
      "claude-code": { exec: "/new/claude" },
      cursor: { exec: "/c" },
    });
    expect(result.step.detail).toContain("/old/claude → /new/claude");
  });

  it("a binary that resolves nowhere is a WARNING, not a refusal — doctor judges for real", () => {
    const result = ok(
      plan({ key: "agent", value: "claude-code", exec: "/nope/claude", execFound: false }),
    );
    expect(result.step.action).toBe("set");
    expect(result.step.detail).toContain("WARNING");
  });

  it("never removes what it was not asked about", () => {
    const result = ok(
      plan({
        current: { agents: { "claude-code": { exec: "/c" } }, operator: "dev-core" },
        key: "instance",
        value: "laptop",
      }),
    );
    expect(result.next.operator).toBe("dev-core");
    expect(result.next.agents).toEqual({ "claude-code": { exec: "/c" } });
  });
});

describe("planConfigSet — the door", () => {
  it("refuses a POLICY key BY THE RULE, not as a typo", () => {
    const said = refusal(plan({ key: "roles", value: "dev-core" }));
    expect(said).toContain("POLICY");
    expect(said).toContain("behind a PR");
  });

  it("refuses 'instances' — the plural is the topology, and that is policy too", () => {
    expect(refusal(plan({ key: "instances", value: "lle-agents" }))).toContain("POLICY");
  });

  it("refuses an unknown key and lists what the machine config holds", () => {
    const said = refusal(plan({ key: "banana", value: "x" }));
    expect(said).toContain("unknown key 'banana'");
    expect(said).toContain("'instance'");
    expect(said).toContain("'agent'");
  });

  it("refuses a key with no value, and names the form", () => {
    expect(refusal(plan({ key: "instance" }))).toContain("'config set instance <id>'");
  });

  it("refuses a blank value — whitespace is not an id", () => {
    expect(refusal(plan({ key: "operator", value: "   " }))).toContain("needs a value");
  });

  it("refuses 'agent' without --exec: WHERE the binary is is all this file says about a tool", () => {
    expect(refusal(plan({ key: "agent", value: "claude-code" }))).toContain("--exec <path>");
  });

  it("refuses 'agent' with no tool named", () => {
    expect(refusal(plan({ key: "agent", exec: "/bin/claude" }))).toContain(
      "'config set agent <kind> --exec <path>'",
    );
  });

  it("refuses --exec beside a key it does not belong to, instead of dropping it silently", () => {
    const said = refusal(plan({ key: "instance", value: "laptop", exec: "/bin/claude" }));
    expect(said).toContain("--exec belongs to");
  });

  it("says nothing at all when nothing was named", () => {
    expect(refusal(plan({}))).toContain("config set <key> <value>");
  });
});

describe("planConfigSet — accounts (thread 055)", () => {
  it("declares where an account of this box lives", () => {
    const result = ok(
      plan({ key: "account", value: "lle-second", configDir: "/home/lle/.claude-lle-second" }),
    );
    expect(result.step.name).toBe("account: lle-second");
    expect(result.step.action).toBe("set");
    expect(result.next.accounts).toEqual({
      "lle-second": { configDir: "/home/lle/.claude-lle-second" },
    });
  });

  it("A SECOND ACCOUNT DOES NOT ERASE THE FIRST — a box declares them one command at a time", () => {
    const result = ok(
      plan({
        current: { agents: {}, accounts: { "lle-main": { configDir: "/home/lle/.claude" } } },
        key: "account",
        value: "lle-second",
        configDir: "/home/lle/.claude-lle-second",
      }),
    );
    expect(result.next.accounts).toEqual({
      "lle-main": { configDir: "/home/lle/.claude" },
      "lle-second": { configDir: "/home/lle/.claude-lle-second" },
    });
  });

  it("a directory that is not there yet is NOT a refusal — it carries the login that creates it", () => {
    const result = ok(
      plan({
        key: "account",
        value: "lle-second",
        configDir: "/home/lle/.claude-lle-second",
        configDirExists: false,
      }),
    );
    expect(result.step.action).toBe("set");
    expect(result.step.detail).toContain(
      "CLAUDE_CONFIG_DIR=/home/lle/.claude-lle-second claude login",
    );
  });

  it("prints both sides of a moved account directory", () => {
    const result = ok(
      plan({
        current: { agents: {}, accounts: { "lle-second": { configDir: "/old/dir" } } },
        key: "account",
        value: "lle-second",
        configDir: "/new/dir",
        configDirExists: true,
      }),
    );
    expect(result.step.action).toBe("change");
    expect(result.step.detail).toContain("/old/dir → /new/dir");
  });

  it("the same directory again is a 'keep', so the file is not rewritten", () => {
    const result = ok(
      plan({
        current: { agents: {}, accounts: { "lle-second": { configDir: "/dir" } } },
        key: "account",
        value: "lle-second",
        configDir: "/dir",
      }),
    );
    expect(result.step.action).toBe("keep");
  });

  it("refuses 'account' without --config-dir: WHERE it lives is all this file says", () => {
    expect(refusal(plan({ key: "account", value: "lle-second" }))).toContain("--config-dir <path>");
  });

  it("refuses 'account' with no account named", () => {
    expect(refusal(plan({ key: "account", configDir: "/dir" }))).toContain(
      "'config set account <id> --config-dir <path>'",
    );
  });

  it("REFUSES A RELATIVE PATH — the daemon that reads it was started somewhere else", () => {
    const said = refusal(
      plan({ key: "account", value: "lle-second", configDir: ".claude-second" }),
    );
    expect(said).toContain("is relative");
    expect(said).toContain("CLAUDE_CONFIG_DIR");
  });

  it("refuses --config-dir beside a key it does not belong to", () => {
    expect(refusal(plan({ key: "instance", value: "laptop", configDir: "/dir" }))).toContain(
      "--config-dir belongs to",
    );
  });

  it("refuses --exec on an account — the plausible slip, both being 'where it lives'", () => {
    const said = refusal(plan({ key: "account", value: "lle-second", exec: "/bin/claude" }));
    expect(said).toContain("--exec belongs to");
    expect(said).toContain("--config-dir <path>");
  });
});

describe("configSetSummary", () => {
  it("without --write it names the flag and promises the file was untouched", () => {
    const result = ok(plan({ key: "instance", value: "laptop" }));
    const said = configSetSummary({ step: result.step, write: false, path: base.path });
    expect(said).toContain("--write does it");
    expect(said).toContain(base.path);
  });

  it("with --write it is in the past tense", () => {
    const result = ok(plan({ key: "instance", value: "laptop" }));
    expect(configSetSummary({ step: result.step, write: true, path: base.path })).toContain(
      "written",
    );
  });
});
