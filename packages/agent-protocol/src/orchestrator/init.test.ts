import { describe, expect, it } from "vitest";

import {
  agentStep,
  initBlockers,
  initSummary,
  initTouches,
  instanceStep,
  mailStep,
  nextLocalConfig,
  operatorStep,
  renderInitSteps,
  secretsStep,
} from "./init.js";

describe("instanceStep", () => {
  it("refuses to guess a name when the repository declares instances", () => {
    const step = instanceStep({ declared: ["main", "lle-agents"] });
    expect(step.action).toBe("missing");
    expect(step.detail).toContain("--instance");
    expect(step.detail).toContain("'main'");
  });

  it("has nothing to name when the repository declares no instances", () => {
    expect(instanceStep({ declared: [] }).action).toBe("skip");
  });

  it("sets a name this box did not have", () => {
    const step = instanceStep({ requested: "main", declared: ["main"] });
    expect(step.action).toBe("set");
    expect(step.detail).toContain("'main'");
  });

  it("keeps an unchanged name and writes nothing", () => {
    expect(instanceStep({ requested: "main", current: "main", declared: ["main"] }).action).toBe(
      "keep",
    );
  });

  it("names BOTH sides of an overwrite", () => {
    const step = instanceStep({ requested: "lle-agents", current: "main", declared: ["main"] });
    expect(step.action).toBe("change");
    expect(step.detail).toContain("'main'");
    expect(step.detail).toContain("'lle-agents'");
  });

  it("calls an undeclared name a bench rather than an error", () => {
    const step = instanceStep({ requested: "laptop", declared: ["main"] });
    expect(step.action).toBe("set");
    expect(step.detail).toContain("bench");
  });

  it("warns with the neighbour's own digest when the id is already published", () => {
    const step = instanceStep({
      requested: "main",
      declared: ["main"],
      occupant: { writtenAt: "2026-07-31T10:00:00.000Z", roles: ["curator", "dev-core"] },
    });
    // A WARNING, never a refusal: the digest carries no machine identity, so a box
    // re-commissioning ITSELF would be refused by a rule that read its own file as
    // somebody else's — and re-commissioning is the acceptance criterion of the thread.
    expect(step.action).toBe("set");
    expect(step.detail).toContain("2026-07-31T10:00:00.000Z");
    expect(step.detail).toContain("curator");
  });
});

describe("agentStep", () => {
  it("takes what is on PATH, with the version it printed", () => {
    const step = agentStep({
      kind: "claude-code",
      resolved: "/usr/local/bin/claude",
      version: "1.2.3",
    });
    expect(step.action).toBe("set");
    expect(step.detail).toContain("/usr/local/bin/claude");
    expect(step.detail).toContain("1.2.3");
  });

  it("asks for --exec when there is nothing on PATH and nothing declared", () => {
    const step = agentStep({ kind: "claude-code" });
    expect(step.action).toBe("missing");
    expect(step.detail).toContain("--exec");
  });

  it("does NOT overwrite a declared path with what PATH happens to offer", () => {
    const step = agentStep({
      kind: "claude-code",
      current: "/opt/pinned/claude",
      resolved: "/usr/bin/claude",
    });
    expect(step.action).toBe("keep");
    expect(step.detail).toContain("/opt/pinned/claude");
    expect(step.detail).toContain("--exec");
  });

  it("overwrites when the operator named the path themselves", () => {
    const step = agentStep({
      kind: "claude-code",
      requested: "/usr/bin/claude",
      current: "/opt/pinned/claude",
    });
    expect(step.action).toBe("change");
    expect(step.detail).toContain("/opt/pinned/claude");
  });
});

describe("operatorStep", () => {
  it("is a skip when nobody is named — $USER still answers", () => {
    expect(operatorStep({ known: ["curator"] }).action).toBe("skip");
  });

  it("warns when the named operator is no role of this project", () => {
    const step = operatorStep({ requested: "cosysoft", known: ["curator", "dev-core"] });
    expect(step.action).toBe("set");
    expect(step.detail).toContain("no role of this project");
  });
});

describe("secretsStep", () => {
  it("says what the absence costs and that init writes no such file", () => {
    const step = secretsStep({});
    expect(step.action).toBe("skip");
    expect(step.detail).toContain("never writes the file itself");
  });

  it("records a path whose file is not there yet", () => {
    const step = secretsStep({ requested: "/home/op/secrets.env", exists: false });
    expect(step.action).toBe("set");
    expect(step.detail).toContain("not there yet");
  });
});

describe("mailStep", () => {
  it("says the fetch out loud when it creates the checkout", () => {
    const step = mailStep({ path: "/repo/.worktrees/comms", present: false, branch: "comms" });
    expect(step.action).toBe("create");
    expect(step.detail).toContain("fetch");
    expect(step.detail).toContain("comms");
  });

  it("keeps a checkout that is already there", () => {
    expect(
      mailStep({ path: "/repo/.worktrees/comms", present: true, branch: "comms" }).action,
    ).toBe("keep");
  });
});

describe("nextLocalConfig", () => {
  it("adds an agent without dropping the ones already declared", () => {
    const next = nextLocalConfig(
      { agents: { cursor: { exec: "/usr/bin/cursor" } } },
      { agent: { kind: "claude-code", exec: "/usr/bin/claude" } },
    );
    expect(next.agents).toEqual({
      cursor: { exec: "/usr/bin/cursor" },
      "claude-code": { exec: "/usr/bin/claude" },
    });
  });

  it("removes nothing: a fact this run said nothing about survives", () => {
    const next = nextLocalConfig(
      { agents: {}, instance: "main", operator: "curator", secrets: { envFile: "/s.env" } },
      {},
    );
    expect(next).toEqual({
      agents: {},
      instance: "main",
      operator: "curator",
      secrets: { envFile: "/s.env" },
    });
  });

  it("replaces the values the operator named", () => {
    const next = nextLocalConfig(
      { agents: {}, instance: "main" },
      { instance: "lle-agents", secretsEnvFile: "/new.env" },
    );
    expect(next.instance).toBe("lle-agents");
    expect(next.secrets).toEqual({ envFile: "/new.env" });
  });
});

describe("the summary", () => {
  const kept = { name: "instance", action: "keep", detail: "'main'" } as const;
  const set = { name: "operator", action: "set", detail: "curator" } as const;
  const missing = { name: "agent: claude-code", action: "missing", detail: "--exec" } as const;

  it("names the blockers instead of counting them", () => {
    expect(initSummary({ steps: [kept, missing], write: false })).toContain("agent: claude-code");
    expect(initBlockers([kept, missing])).toHaveLength(1);
  });

  it("says the flag when nothing was touched", () => {
    const line = initSummary({ steps: [set], write: false });
    expect(line).toContain("--write");
    // The plain sentence is only allowed when it is TRUE: no branch was read, so nothing
    // on this disk moved. The claim itself is the thing under test.
    expect(line).toContain("nothing was touched");
  });

  it("names the fetch the plan made instead of promising it touched nothing", () => {
    const line = initSummary({ steps: [set], write: false, fetched: "comms" });
    // Round 7 of thread 019: the occupancy of an instance id cannot be read on a fresh
    // box without fetching the mail branch, and the line used to say the opposite.
    expect(line).not.toContain("nothing was touched");
    expect(line).toContain("'comms' was fetched");
    expect(line).toContain("origin/comms");
    expect(line).toContain("--write does it");
  });

  it("says so when the box was already commissioned", () => {
    expect(initSummary({ steps: [kept], write: true })).toContain("already commissioned");
    expect(initTouches([kept])).toBe(false);
  });

  it("hands the verdict to doctor rather than claiming one", () => {
    const line = initSummary({ steps: [set], write: true });
    expect(line).toContain("doctor's answer, not init's");
  });
});

describe("rendering", () => {
  it("aligns the rows and marks a refusal apart from a change", () => {
    const rendered = renderInitSteps([
      { name: "instance", action: "change", detail: "a → b" },
      { name: "agent: claude-code", action: "missing", detail: "--exec" },
    ]);
    expect(rendered.split("\n")[0]).toBe("~ instance            a → b");
    expect(rendered).toContain("✗ agent: claude-code");
  });
});
