import { describe, expect, it } from "vitest";

import type { Role } from "../roles/schema.js";
import type { OrchestratorEvent } from "./journal.js";
import {
  buildLaunchArgv,
  buildLaunchPrompt,
  consecutiveLaunchesWithoutCompletion,
  describeLaunch,
  MAX_CONSECUTIVE_RUNS,
  planLaunch,
  roleLaunchability,
} from "./launch.js";

const role = (over: Partial<Role>): Role => ({
  id: "dev-core",
  kind: "claude-code",
  status: "active",
  wake: { mode: "watch", session: "lle-dev-core" },
  summary: "…",
  permissions: [],
  instructions: [{ kind: "in-repo", path: "CLAUDE.md" }],
  launch: { allowedTools: ["Bash", "Read", "Edit", "Write"] },
  ...over,
});

describe("roleLaunchability", () => {
  it("watch + in-repo instructions + active → launchable", () => {
    expect(roleLaunchability(role({}))).toEqual({ launchable: true });
  });

  it("wake=self (a human) → not launchable", () => {
    expect(roleLaunchability(role({ wake: { mode: "self" } }))).toEqual({
      launchable: false,
      reason: "wake-not-watch",
    });
  });

  it("wake=via-human (an assistant reached through a human) → not launchable", () => {
    expect(roleLaunchability(role({ wake: { mode: "via-human", via: "john" } })).launchable).toBe(
      false,
    );
  });

  it("wake=event (the platform wakes it) → not launchable", () => {
    expect(roleLaunchability(role({ wake: { mode: "event" } })).launchable).toBe(false);
  });

  it("no instructions → a no-instructions refusal, not a crash", () => {
    const r: Role = { ...role({}), instructions: undefined };
    expect(roleLaunchability(r)).toEqual({ launchable: false, reason: "no-instructions" });
  });

  it("external instructions (executed outside) → an external-instructions refusal", () => {
    expect(
      roleLaunchability(role({ instructions: [{ kind: "external", path: "skill.md" }] })),
    ).toEqual({ launchable: false, reason: "external-instructions" });
  });

  it("status other than active → an inactive refusal", () => {
    expect(roleLaunchability(role({ status: "paused" }))).toEqual({
      launchable: false,
      reason: "inactive",
    });
  });
});

describe("buildLaunchPrompt", () => {
  const prompt = buildLaunchPrompt({
    role: "dev-core",
    thread: "014-x",
    instructions: [
      { path: "CLAUDE.md", text: "the project rules" },
      { path: "apps/api/CLAUDE.md", text: "the api rules" },
    ],
  });

  it("carries the role and the thread", () => {
    expect(prompt).toContain("`dev-core`");
    expect(prompt).toContain("`014-x`");
  });

  it("hard-limits the run to a single thread", () => {
    expect(prompt).toContain("AND ON THAT ONE ONLY");
  });

  it("includes the texts of all instructions in reading order", () => {
    expect(prompt).toContain("the project rules");
    expect(prompt).toContain("the api rules");
    expect(prompt.indexOf("the project rules")).toBeLessThan(prompt.indexOf("the api rules"));
  });
});

const launch = (role: string, thread: string): OrchestratorEvent => ({
  kind: "launch",
  ts: "2026-07-24T12:00:00Z",
  role,
  thread,
});
const completed = (role: string, thread: string): OrchestratorEvent => ({
  kind: "lease-released",
  ts: "2026-07-24T12:00:00Z",
  role,
  thread,
  reason: "completed",
});
const timedOut = (role: string, thread: string): OrchestratorEvent => ({
  kind: "lease-released",
  ts: "2026-07-24T12:00:00Z",
  role,
  thread,
  reason: "timeout",
});

describe("consecutiveLaunchesWithoutCompletion", () => {
  it("counts launches, completed resets", () => {
    expect(
      consecutiveLaunchesWithoutCompletion([
        launch("a", "1"),
        completed("a", "1"),
        launch("a", "2"),
        launch("a", "3"),
      ]),
    ).toBe(2);
  });

  it("a break loop (timeout, not completed) accumulates", () => {
    expect(
      consecutiveLaunchesWithoutCompletion([
        launch("a", "1"),
        timedOut("a", "1"),
        launch("a", "1"),
        timedOut("a", "1"),
      ]),
    ).toBe(2);
  });
});

const NOW = new Date("2026-07-24T14:00:00Z");

describe("planLaunch", () => {
  it("a fresh pair → ok, lease-acquired+launch events with a materialised deadline", () => {
    const plan = planLaunch({
      events: [],
      role: "dev-core",
      thread: "t",
      now: NOW,
      wallClockMs: 900_000,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.deadline).toBe("2026-07-24T14:15:00Z");
    expect(plan.events.map((e) => e.kind)).toEqual(["lease-acquired", "launch"]);
  });

  it("the pair is already running → an already-running refusal (no second run)", () => {
    const events: OrchestratorEvent[] = [
      {
        kind: "lease-acquired",
        ts: "2026-07-24T13:00:00Z",
        role: "dev-core",
        thread: "t",
        deadline: "2026-07-24T15:00:00Z",
      },
    ];
    expect(
      planLaunch({ events, role: "dev-core", thread: "t", now: NOW, wallClockMs: 900_000 }),
    ).toEqual({
      ok: false,
      reason: "already-running",
    });
  });

  it("the pair is exhausted → an exhausted refusal (the attempt ceiling on the thread)", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < 3; i += 1) {
      events.push(
        {
          kind: "lease-acquired",
          ts: "2026-07-24T13:00:00Z",
          role: "dev-core",
          thread: "t",
          deadline: "2026-07-24T13:30:00Z",
        },
        {
          kind: "lease-released",
          ts: "2026-07-24T13:31:00Z",
          role: "dev-core",
          thread: "t",
          reason: "timeout",
        },
      );
    }
    expect(
      planLaunch({ events, role: "dev-core", thread: "t", now: NOW, wallClockMs: 900_000 }).ok,
    ).toBe(false);
    expect(
      planLaunch({ events, role: "dev-core", thread: "t", now: NOW, wallClockMs: 900_000 }),
    ).toMatchObject({
      reason: "exhausted",
    });
  });

  it("the global ceiling of runs without a completed → a run-budget refusal", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_CONSECUTIVE_RUNS; i += 1) events.push(launch("x", `t${i}`));
    // a different, fresh pair — but the global ceiling is already exhausted
    expect(
      planLaunch({ events, role: "dev-core", thread: "fresh", now: NOW, wallClockMs: 900_000 }),
    ).toEqual({ ok: false, reason: "run-budget" });
  });

  it("the run ceiling is calibrated by a parameter", () => {
    const events = [launch("x", "1"), launch("x", "2")];
    expect(
      planLaunch({
        events,
        role: "dev-core",
        thread: "t",
        now: NOW,
        wallClockMs: 1000,
        maxConsecutive: 2,
      }).ok,
    ).toBe(false);
    expect(
      planLaunch({
        events,
        role: "dev-core",
        thread: "t",
        now: NOW,
        wallClockMs: 1000,
        maxConsecutive: 5,
      }).ok,
    ).toBe(true);
  });
});

describe("the permission profile — part of the launch contract (S7)", () => {
  it("a role without a profile is NOT launched: raising it with unassigned permissions is not allowed", () => {
    const { launch: _dropped, ...without } = role({});
    expect(roleLaunchability(without as Role)).toEqual({
      launchable: false,
      reason: "no-launch-profile",
    });
  });

  it("argv carries --allowedTools — what the first production run did not have", () => {
    const argv = buildLaunchArgv({
      prompt: "the prompt",
      maxTurns: "60",
      launch: { allowedTools: ["Bash", "Read", "Edit", "Write"] },
    });
    expect(argv).toEqual([
      "-p",
      "the prompt",
      "--allowedTools",
      "Bash,Read,Edit,Write",
      "--max-turns",
      "60",
    ]);
  });

  it("the shape of argv is NAILED DOWN: the order and the form are a contract, not an implementation detail", () => {
    // The P0 spike called the agent with --allowedTools and stayed green while the
    // code regressed: argv was pinned by nothing, and the permissions silently
    // dropped out.
    const argv = buildLaunchArgv({
      prompt: "p",
      maxTurns: "25",
      launch: { allowedTools: ["Bash"] },
    });
    expect(argv).toHaveLength(6);
    expect(argv[0]).toBe("-p");
    expect(argv.indexOf("--allowedTools")).toBe(2);
    expect(argv.at(-2)).toBe("--max-turns");
  });

  it("the tools go through as they are, the order is preserved", () => {
    const argv = buildLaunchArgv({
      prompt: "p",
      maxTurns: "1",
      launch: { allowedTools: ["Read", "Bash"] },
    });
    expect(argv[3]).toBe("Read,Bash");
  });

  it("describeLaunch shows the role's permissions as a line", () => {
    expect(describeLaunch(role({}))).toBe("dev-core: Bash, Read, Edit, Write");
  });

  it("describeLaunch on a role without a profile names the REASON instead of staying silent", () => {
    const { launch: _dropped, ...without } = role({ instructions: undefined });
    expect(describeLaunch(without as Role)).toContain("no-instructions");
  });
});
