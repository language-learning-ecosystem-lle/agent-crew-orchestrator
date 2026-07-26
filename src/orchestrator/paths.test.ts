import { describe, expect, it } from "vitest";

import {
  orchestratorPaths,
  renderPaths,
  sessionIdPath,
  sessionLogPath,
  sessionStreamPath,
  sessionSupervisorPath,
  sessionWaitPath,
  waitPathFromSessionFile,
} from "./paths.js";

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
    expect(rendered).toContain("/repo/.orchestrator/notify.state");
    expect(rendered.split("\n")).toHaveLength(7);
  });
});

describe("sessionIdPath", () => {
  it("is the third file of one run's triple: log, raw stream, session id", () => {
    const log = sessionLogPath("/s", "dev-core", "016-x", "2026-07-25T18:00:00Z");

    expect(sessionIdPath(log)).toBe(log.replace(/\.log$/, ".session"));
    expect(sessionStreamPath(log)).toBe(log.replace(/\.log$/, ".jsonl"));
  });
});

describe("sessionSupervisorPath", () => {
  it("is the fourth file of one run's family — what the OBSERVER said (R12)", () => {
    const log = sessionLogPath("/s", "dev-core", "016-x", "2026-07-25T18:00:00Z");

    expect(sessionSupervisorPath(log)).toBe(log.replace(/\.log$/, ".supervisor"));
    // One run is one name in a directory listing, four extensions apart.
    const names = [log, sessionStreamPath(log), sessionIdPath(log), sessionSupervisorPath(log)];
    expect(new Set(names.map((name) => name.replace(/\.[^.]+$/, ""))).size).toBe(1);
  });
});

describe("the wait marker of an interactive turn (R19)", () => {
  const log = sessionLogPath("/s", "dev-core", "016-x", "2026-07-25T18:00:00Z");

  it("is the fifth file of the family, and both ends derive the SAME path", () => {
    // The writer is the session (which only knows the session-id path from its
    // environment), the reader is its supervisor (which knows the log path). One file,
    // reached from either side — otherwise a declaration would be written where nobody
    // looks.
    expect(sessionWaitPath(log)).toBe(log.replace(/\.log$/, ".waiting"));
    expect(waitPathFromSessionFile(sessionIdPath(log))).toBe(sessionWaitPath(log));
  });

  it("a value that is not a session-id path yields NOTHING, never the value itself", () => {
    // A blind `replace` would return the name unchanged — i.e. write the marker over
    // the file it was derived from.
    expect(waitPathFromSessionFile("/s/whatever.log")).toBeUndefined();
    expect(waitPathFromSessionFile("")).toBeUndefined();
  });
});
