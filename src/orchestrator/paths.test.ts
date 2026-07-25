import { describe, expect, it } from "vitest";

import { orchestratorPaths, renderPaths } from "./paths.js";

const input = {
  repo: "/repo",
  orchestrator: { state: ".orchestrator", mailCheckout: ".worktrees/comms", ref: "origin/main" },
  mail: { branch: "comms", dir: "agent-comms" },
};

describe("orchestratorPaths", () => {
  it("the whole state sits under one directory taken from the config", () => {
    const paths = orchestratorPaths(input);
    expect(paths.state).toBe("/repo/.orchestrator");
    expect(paths.journal).toBe("/repo/.orchestrator/journal.jsonl");
    expect(paths.enableFlag).toBe("/repo/.orchestrator/enabled");
    expect(paths.stopFlag).toBe("/repo/.orchestrator/stop");
    expect(paths.forceFlag).toBe("/repo/.orchestrator/force");
    expect(paths.holds).toBe("/repo/.orchestrator/holds");
  });

  it("the mail root is the branch checkout plus the mail directory from the mail section", () => {
    expect(orchestratorPaths(input).mailRoot).toBe("/repo/.worktrees/comms/agent-comms");
  });

  it("the project moves the state with a single field, file names do not change", () => {
    const moved = orchestratorPaths({
      ...input,
      orchestrator: { ...input.orchestrator, state: "var/orchestrator" },
    });
    expect(moved.journal).toBe("/repo/var/orchestrator/journal.jsonl");
    expect(moved.holds).toBe("/repo/var/orchestrator/holds");
  });

  it("the mail directory comes from mail.dir and is not hardcoded", () => {
    const other = orchestratorPaths({ ...input, mail: { branch: "comms", dir: "inbox" } });
    expect(other.mailRoot).toBe("/repo/.worktrees/comms/inbox");
  });
});

describe("renderPaths", () => {
  it("shows a human where every file lies — the flags included", () => {
    const rendered = renderPaths(orchestratorPaths(input));
    expect(rendered).toContain("/repo/.orchestrator/journal.jsonl");
    expect(rendered).toContain("/repo/.orchestrator/enabled");
    expect(rendered).toContain("/repo/.worktrees/comms/agent-comms");
    expect(rendered.split("\n")).toHaveLength(6);
  });
});
