import { describe, expect, it } from "vitest";

import type { Role } from "../roles/schema.js";
import type { OrchestratorEvent } from "./journal.js";
import {
  buildLaunchArgv,
  buildLaunchPrompt,
  consecutiveLaunchesWithoutCompletion,
  describeCeilings,
  describeLaunch,
  MAX_CONSECUTIVE_RUNS,
  planLaunch,
  resolveCeilings,
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
      "--output-format",
      "stream-json",
      "--verbose",
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
    expect(argv).toHaveLength(9);
    expect(argv[0]).toBe("-p");
    expect(argv.indexOf("--allowedTools")).toBe(2);
    expect(argv[4]).toBe("--max-turns");
  });

  it("argv asks for the STREAMING format — otherwise a broken-off run leaves an empty log (R6)", () => {
    // With the default format the agent prints its answer once, at the end. A
    // session cut by a deadline or a turn ceiling never gets there — and those are
    // exactly the runs the log is read for.
    const argv = buildLaunchArgv({
      prompt: "p",
      maxTurns: "1",
      launch: { allowedTools: ["Bash"] },
    });
    expect(argv.slice(-3)).toEqual(["--output-format", "stream-json", "--verbose"]);
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

describe("resolveCeilings — the flag, then the role, then the default (R12)", () => {
  const defaults = { idleSeconds: 600, wallClockSeconds: 3600, maxTurns: 300 };

  it("nothing said anywhere → the package defaults, and they say so", () => {
    const ceilings = resolveCeilings({ flags: {}, defaults });
    expect(ceilings.idle).toEqual({ value: 600, source: "default" });
    expect(ceilings.wallClock).toEqual({ value: 3600, source: "default" });
    expect(ceilings.maxTurns).toEqual({ value: 300, source: "default" });
  });

  it("the role's launch.limits win over the defaults", () => {
    const ceilings = resolveCeilings({
      flags: {},
      limits: { idleSeconds: 120, wallClockSeconds: 900, maxTurns: 60 },
      defaults,
    });
    expect(ceilings.idle).toEqual({ value: 120, source: "role" });
    expect(ceilings.wallClock).toEqual({ value: 900, source: "role" });
    expect(ceilings.maxTurns).toEqual({ value: 60, source: "role" });
  });

  it("the flag wins over the role: a human typed it for THIS run", () => {
    const ceilings = resolveCeilings({
      flags: { wallClockSeconds: 30 },
      limits: { wallClockSeconds: 900 },
      defaults,
    });
    expect(ceilings.wallClock).toEqual({ value: 30, source: "flag" });
  });

  it("the three ceilings are resolved INDEPENDENTLY — one flag does not drop the other two", () => {
    // The mistake this pins down: taking the role's limits as a block, so naming a
    // single flag would quietly return the whole run to the defaults.
    const ceilings = resolveCeilings({
      flags: { maxTurns: 20 },
      limits: { idleSeconds: 120, wallClockSeconds: 900, maxTurns: 60 },
      defaults,
    });
    expect(ceilings.maxTurns).toEqual({ value: 20, source: "flag" });
    expect(ceilings.idle).toEqual({ value: 120, source: "role" });
    expect(ceilings.wallClock).toEqual({ value: 900, source: "role" });
  });

  it("ZERO SURVIVES: 'idle 0' is the detector switched off, not an absent value", () => {
    expect(
      resolveCeilings({ flags: { idleSeconds: 0 }, limits: { idleSeconds: 120 }, defaults }),
    ).toMatchObject({ idle: { value: 0, source: "flag" } });
    expect(resolveCeilings({ flags: {}, limits: { idleSeconds: 0 }, defaults })).toMatchObject({
      idle: { value: 0, source: "role" },
    });
  });

  it("a partial limits block falls through field by field, not as a whole", () => {
    const ceilings = resolveCeilings({ flags: {}, limits: { maxTurns: 60 }, defaults });
    expect(ceilings.maxTurns.source).toBe("role");
    expect(ceilings.idle).toEqual({ value: 600, source: "default" });
  });

  it("describeCeilings names the number AND its source — a ceiling that fired must be attributable", () => {
    const line = describeCeilings(
      resolveCeilings({ flags: { wallClockSeconds: 30 }, limits: { idleSeconds: 120 }, defaults }),
    );
    expect(line).toContain("idle 120s (role)");
    expect(line).toContain("wall-clock 30s (flag)");
    expect(line).toContain("max-turns 300 (default)");
  });

  it("a switched-off idle detector reads as 'off', not as '0s'", () => {
    expect(describeCeilings(resolveCeilings({ flags: { idleSeconds: 0 }, defaults }))).toContain(
      "idle off (flag)",
    );
  });
});
