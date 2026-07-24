import { describe, expect, it } from "vitest";

import { orchestratorPaths, renderPaths } from "./paths.js";

const input = {
  repo: "/repo",
  orchestrator: { state: ".orchestrator", mailCheckout: ".worktrees/comms", ref: "origin/main" },
  mail: { branch: "comms", dir: "agent-comms" },
};

describe("orchestratorPaths", () => {
  it("всё состояние — под одним каталогом из конфига", () => {
    const paths = orchestratorPaths(input);
    expect(paths.state).toBe("/repo/.orchestrator");
    expect(paths.journal).toBe("/repo/.orchestrator/journal.jsonl");
    expect(paths.enableFlag).toBe("/repo/.orchestrator/enabled");
    expect(paths.stopFlag).toBe("/repo/.orchestrator/stop");
    expect(paths.forceFlag).toBe("/repo/.orchestrator/force");
    expect(paths.holds).toBe("/repo/.orchestrator/holds");
  });

  it("корень почты — чекаут ветки плюс каталог почты из секции mail", () => {
    expect(orchestratorPaths(input).mailRoot).toBe("/repo/.worktrees/comms/agent-comms");
  });

  it("проект переносит состояние одним полем, имена файлов не меняются", () => {
    const moved = orchestratorPaths({
      ...input,
      orchestrator: { ...input.orchestrator, state: "var/orchestrator" },
    });
    expect(moved.journal).toBe("/repo/var/orchestrator/journal.jsonl");
    expect(moved.holds).toBe("/repo/var/orchestrator/holds");
  });

  it("каталог почты берётся из mail.dir, а не зашит", () => {
    const other = orchestratorPaths({ ...input, mail: { branch: "comms", dir: "почта" } });
    expect(other.mailRoot).toBe("/repo/.worktrees/comms/почта");
  });
});

describe("renderPaths", () => {
  it("показывает человеку, где лежит каждый файл — включая флаги", () => {
    const rendered = renderPaths(orchestratorPaths(input));
    expect(rendered).toContain("/repo/.orchestrator/journal.jsonl");
    expect(rendered).toContain("/repo/.orchestrator/enabled");
    expect(rendered).toContain("/repo/.worktrees/comms/agent-comms");
    expect(rendered.split("\n")).toHaveLength(5);
  });
});
