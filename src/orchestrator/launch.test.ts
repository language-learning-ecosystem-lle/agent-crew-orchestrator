import { describe, expect, it } from "vitest";

import type { Role } from "../roles/schema.js";
import type { OrchestratorEvent } from "./journal.js";
import {
  buildLaunchArgv,
  buildLaunchPrompt,
  buildResumePrompt,
  consecutiveLaunchesWithoutDelivery,
  DEFAULT_EXEC,
  DEFAULT_WORKER,
  defaultWindDownSeconds,
  describeAgent,
  describeCeilings,
  describeGates,
  describeLaunch,
  MAX_CONSECUTIVE_RUNS,
  planLaunch,
  resolveAgentParams,
  resolveCeilings,
  resolveExec,
  resolveGates,
  resolveWorker,
  roleLaunchability,
  WIND_DOWN_MAX_SECONDS,
  WIND_DOWN_MIN_SECONDS,
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
    deadline: "2026-07-26T15:00:00Z",
    windDownSeconds: 720,
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

  it("TELLS THE SESSION ITS DEADLINE AND THE NORM OF LANDING (R20)", () => {
    // The whole of R20 rests on this paragraph: the environment variable and the wall
    // clock only make it possible, but nobody lands a run except the session, and a
    // session that has not been told its deadline cannot land before it.
    expect(prompt).toContain("2026-07-26T15:00:00Z");
    expect(prompt).toContain("AGENT_PROTOCOL_LEASE_DEADLINE");
    expect(prompt).toContain("12 minutes");
    expect(prompt).toContain("commit it AS IT IS");
    expect(prompt).toContain("FAILURE");
    // Landing is NOT parking (curator: do not glue the two into one state) — the
    // difference is said in the same breath the two are mentioned together.
    expect(prompt).toContain("parking is a pause your own session continues");
  });

  it("OFFERS THE INTERACTIVE TURN, with both commands and the threshold (R19)", () => {
    // A capability nobody was told about does not exist: without these words the
    // session goes on dying with its question, which is the whole failure R19 removes.
    // The threshold is in the same paragraph on purpose — parking at the END of a task
    // is more expensive than answering and letting the run finish.
    expect(prompt).toContain("new-message --await-input");
    expect(prompt).toContain("await-input");
    expect(prompt).toContain("what is uncommitted");
    expect(prompt).toContain("END of the task");
  });

  it("SAYS THAT A FINISHED TURN ENDS THE SESSION, and forbids the third ending (thread 018)", () => {
    // Two autonomous runs out of two ended `exited-without-handoff` by finishing the
    // turn in the belief that a notification would wake them back up. The runtime never
    // says otherwise, so the prompt has to — and it has to name the illegal ending
    // itself: the sessions that invented it had already read both legal ones.
    expect(prompt).toContain("ENDING YOUR TURN ENDS THIS SESSION");
    expect(prompt).toContain("no resume happens");
    expect(prompt).toContain("WAIT IN THE FOREGROUND");
    expect(prompt).toContain("meaning to come back when something reports is never one of them");
  });

  it("keeps the no-resume fact and the landing norm as separate paragraphs (thread 018)", () => {
    // They answer different questions — "a finished turn is final" vs "land before the
    // deadline" — and the second already carries one distinction of its own (landing is
    // not parking). Merged, the run out of ceiling and the run that walked away would
    // read as one failure with one remedy.
    const noResume = prompt.indexOf("ENDING YOUR TURN ENDS THIS SESSION");
    const landing = prompt.indexOf("YOUR RUN HAS A DEADLINE");
    expect(noResume).toBeGreaterThan(-1);
    expect(noResume).toBeLessThan(landing);
    expect(prompt.slice(noResume, landing)).toContain("\n\n");
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
const handedOff = (role: string, thread: string): OrchestratorEvent => ({
  kind: "handoff-detected",
  ts: "2026-07-24T12:00:00Z",
  role,
  thread,
});
const supervisorGone = (role: string, thread: string): OrchestratorEvent => ({
  kind: "lease-released",
  ts: "2026-07-24T12:00:00Z",
  role,
  thread,
  reason: "supervisor-gone",
});

describe("consecutiveLaunchesWithoutDelivery", () => {
  it("counts launches, completed resets", () => {
    expect(
      consecutiveLaunchesWithoutDelivery([
        launch("a", "1"),
        completed("a", "1"),
        launch("a", "2"),
        launch("a", "3"),
      ]),
    ).toBe(2);
  });

  it("a break loop (timeout, nothing delivered) accumulates", () => {
    expect(
      consecutiveLaunchesWithoutDelivery([
        launch("a", "1"),
        timedOut("a", "1"),
        launch("a", "1"),
        timedOut("a", "1"),
      ]),
    ).toBe(2);
  });

  it("A HANDOFF RESETS IT TOO — the turn passing is the delivery", () => {
    // The symmetry with the per-pair ceiling (curator's decision, 2026-07-26). Without
    // it a run of "handed off, then the supervisor died before writing the release"
    // walks the GLOBAL counter to its ceiling for someone else's crash, and the whole
    // auto loop stops over runs that all delivered.
    expect(
      consecutiveLaunchesWithoutDelivery([
        launch("a", "1"),
        handedOff("a", "1"),
        supervisorGone("a", "1"),
        launch("b", "2"),
        handedOff("b", "2"),
        supervisorGone("b", "2"),
        launch("c", "3"),
      ]),
    ).toBe(1);
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

  it("the pair is PARKED → the same refusal: a waiting session is a live one (R19)", () => {
    const events: OrchestratorEvent[] = [
      {
        kind: "lease-acquired",
        ts: "2026-07-24T13:00:00Z",
        role: "dev-core",
        thread: "t",
        deadline: "2026-07-24T13:30:00Z", // already behind NOW: the work window is frozen
      },
      {
        kind: "input-awaited",
        ts: "2026-07-24T13:10:00Z",
        role: "dev-core",
        thread: "t",
        deadline: "2026-07-24T15:10:00Z",
      },
    ];
    expect(
      planLaunch({ events, role: "dev-core", thread: "t", now: NOW, wallClockMs: 900_000 }),
    ).toEqual({ ok: false, reason: "already-running" });
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

  it("the attempt ceiling is calibrated by a parameter too — the manual run is not a special case", () => {
    // The gate that dropped dev-core×016 was reachable by no flag at all. `run` and the
    // daemon read the same resolution now, so an operator raising a pair by hand can
    // say what ceiling they mean.
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
      planLaunch({
        events,
        role: "dev-core",
        thread: "t",
        now: NOW,
        wallClockMs: 900_000,
        maxAttempts: 5,
      }).ok,
    ).toBe(true);
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

  it("the zone deny rules REACH argv as --settings — the carrying mechanism of door 1 (thread 020)", () => {
    // The whole of door 1 is this join: zones.ts computes the rules, and argv is
    // where they turn into something the raised session actually obeys. Without a
    // test here the pure functions stay green while the flag quietly stops being
    // passed — the same silent regression --allowedTools once had.
    const argv = buildLaunchArgv({
      prompt: "p",
      maxTurns: "25",
      launch: { allowedTools: ["Bash", "Edit"] },
      denyRules: ["Edit(apps/pronunciation-service)", "Edit(apps/pronunciation-service/**)"],
    });
    expect(argv).toEqual([
      "-p",
      "p",
      "--allowedTools",
      "Bash,Edit",
      "--settings",
      JSON.stringify({
        permissions: {
          deny: ["Edit(apps/pronunciation-service)", "Edit(apps/pronunciation-service/**)"],
        },
      }),
      "--max-turns",
      "25",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  it("the --settings JSON is the tool's shape, and the value follows the flag", () => {
    const argv = buildLaunchArgv({
      prompt: "p",
      maxTurns: "1",
      launch: { allowedTools: ["Bash"] },
      denyRules: ["Edit(apps)"],
    });
    const at = argv.indexOf("--settings");
    expect(at).toBeGreaterThan(-1);
    expect(JSON.parse(argv[at + 1] as string)).toEqual({ permissions: { deny: ["Edit(apps)"] } });
  });

  it("no zones — no --settings at all: an empty deny list would still shadow the workspace settings", () => {
    for (const denyRules of [undefined, []]) {
      const argv = buildLaunchArgv({
        prompt: "p",
        maxTurns: "1",
        launch: { allowedTools: ["Bash"] },
        ...(denyRules === undefined ? {} : { denyRules }),
      });
      expect(argv).not.toContain("--settings");
    }
  });

  it("--settings composes with --resume and the tool parameters, in the pinned order", () => {
    const argv = buildLaunchArgv({
      prompt: "p",
      maxTurns: "1",
      launch: { allowedTools: ["Bash"] },
      denyRules: ["Edit(apps)"],
      resume: "sess-1",
      params: {
        model: { value: "opus", source: "role" },
        effort: { value: "high", source: "role" },
      },
    });
    expect(argv.slice(0, 2)).toEqual(["--resume", "sess-1"]);
    expect(argv.indexOf("--settings")).toBeLessThan(argv.indexOf("--max-turns"));
    expect(argv.indexOf("--max-turns")).toBeLessThan(argv.indexOf("--model"));
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
  const defaults = {
    idleSeconds: 600,
    wallClockSeconds: 3600,
    maxTurns: 300,
    waitInputSeconds: 3600,
  };

  it("nothing said anywhere → the package defaults, and they say so", () => {
    const ceilings = resolveCeilings({ flags: {}, defaults });
    expect(ceilings.idle).toEqual({ value: 600, source: "default" });
    expect(ceilings.wallClock).toEqual({ value: 3600, source: "default" });
    expect(ceilings.maxTurns).toEqual({ value: 300, source: "default" });
    expect(ceilings.waitInput).toEqual({ value: 3600, source: "default" });
  });

  it("the wait ceiling resolves through the same three layers (R19)", () => {
    // It is a fourth ceiling and not a special case: the same order, the same printed
    // source. Pinned because the wait is the one clock a run does not spend working,
    // and "who set it" is the first question of a park that ended too early.
    expect(
      resolveCeilings({ flags: {}, limits: { waitInputSeconds: 900 }, defaults }).waitInput,
    ).toEqual({ value: 900, source: "role" });
    expect(
      resolveCeilings({
        flags: { waitInputSeconds: 60 },
        limits: { waitInputSeconds: 900 },
        defaults,
      }).waitInput,
    ).toEqual({ value: 60, source: "flag" });
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

  it("THE LANDING MARGIN IS DERIVED FROM THE RESOLVED WINDOW, not from a constant (R20)", () => {
    // Whoever shortens a run with a flag has not asked for a landing longer than the
    // run, and would not think to say so. The default therefore follows the window that
    // actually won — flag, role or package.
    expect(resolveCeilings({ flags: {}, defaults }).windDown).toEqual({
      value: 720, // 20% of the hour
      source: "default",
    });
    expect(resolveCeilings({ flags: { wallClockSeconds: 900 }, defaults }).windDown).toEqual({
      value: 180, // 20% of the fifteen minutes the flag asked for
      source: "default",
    });
    expect(
      resolveCeilings({ flags: {}, limits: { wallClockSeconds: 1200 }, defaults }).windDown.value,
    ).toBe(240);
  });

  it("the margin has its own flag and its own role field, and both beat the derivation", () => {
    expect(
      resolveCeilings({ flags: {}, limits: { windDownSeconds: 1500 }, defaults }).windDown,
    ).toEqual({ value: 1500, source: "role" });
    expect(
      resolveCeilings({
        flags: { windDownSeconds: 60 },
        limits: { windDownSeconds: 1500 },
        defaults,
      }).windDown,
    ).toEqual({ value: 60, source: "flag" });
  });

  it("the derivation is bounded at both ends and never exceeds the window itself", () => {
    // A quarter of an hour is a landing; an hour of one is idling. And below the floor
    // the margin cannot be longer than the run, or the landing point would fall before
    // the launch.
    expect(defaultWindDownSeconds(36_000)).toBe(WIND_DOWN_MAX_SECONDS);
    expect(defaultWindDownSeconds(300)).toBe(WIND_DOWN_MIN_SECONDS);
    expect(defaultWindDownSeconds(60)).toBe(60);
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
    // The landing point is printed with the rest (R20): "which window this run had" now
    // includes "and when it was supposed to start landing" — the first thing anyone asks
    // of a run that was cut off.
    // 30s here, not the 120s floor: the window itself is 30 seconds (the flag above),
    // and a landing margin longer than the run would put the landing point before the
    // launch.
    expect(line).toContain("wind-down 30s before the deadline (default)");
  });

  it("a switched-off idle detector reads as 'off', not as '0s'", () => {
    expect(describeCeilings(resolveCeilings({ flags: { idleSeconds: 0 }, defaults }))).toContain(
      "idle off (flag)",
    );
  });
});

describe("resolveGates — the two launch gates and where their numbers came from", () => {
  // The defect of 2026-07-26: `--max-runs 20` was passed at a pair that had been
  // dropped by the OTHER gate, and nothing in the output could say so. Both gates are
  // resolved in one place now, and both print their source.
  const defaults = { maxAttempts: 3, maxRuns: 10 };

  it("no flags → both come from the default", () => {
    expect(resolveGates({ flags: {}, defaults })).toEqual({
      maxAttempts: { value: 3, source: "default" },
      maxConsecutive: { value: 10, source: "default" },
    });
  });

  it("a flag overrides the default, per gate", () => {
    const gates = resolveGates({ flags: { maxAttempts: 5 }, defaults });
    expect(gates.maxAttempts).toEqual({ value: 5, source: "flag" });
    expect(gates.maxConsecutive.source).toBe("default");
  });

  it("describeGates names both numbers and both sources", () => {
    const line = describeGates(resolveGates({ flags: { maxRuns: 20 }, defaults }));
    expect(line).toContain("attempts-per-pair ≤ 3 (default)");
    expect(line).toContain("runs-without-delivery ≤ 20 (flag)");
  });

  it("the package defaults are the fallback when none are given", () => {
    expect(resolveGates({ flags: {} }).maxConsecutive.value).toBe(MAX_CONSECUTIVE_RUNS);
  });
});

describe("what is raised, from where and with what (R14 + R15)", () => {
  /** A launch profile, optionally naming the tool — the only field these resolutions read. */
  const profile = (agent?: unknown): NonNullable<Role["launch"]> =>
    ({ allowedTools: ["Bash"], ...(agent === undefined ? {} : { agent }) }) as NonNullable<
      Role["launch"]
    >;

  describe("resolveWorker — which tool", () => {
    it("nobody said anything → the package default", () => {
      expect(resolveWorker({})).toEqual({ value: DEFAULT_WORKER, source: "default" });
    });

    it("the role's launch.agent.kind is the standing declaration", () => {
      expect(resolveWorker({ launch: profile({ kind: "claude-code" }) })).toEqual({
        value: "claude-code",
        source: "role",
      });
    });

    it("the flag wins — a human typed it for THIS run", () => {
      expect(resolveWorker({ flag: "cursor", launch: profile({ kind: "claude-code" }) })).toEqual({
        value: "cursor",
        source: "flag",
      });
    });
  });

  describe("resolveExec — where its binary is", () => {
    const local = { agents: { "claude-code": { exec: "/home/j/.nvm/bin/claude" } } };

    it("no machine config → the bare name, found on PATH", () => {
      expect(resolveExec({ worker: "claude-code" })).toEqual({
        value: DEFAULT_EXEC,
        source: "default",
      });
    });

    it("the machine config answers for the tool it names", () => {
      expect(resolveExec({ worker: "claude-code", local })).toEqual({
        value: "/home/j/.nvm/bin/claude",
        source: "machine",
      });
    });

    it("…and only for that tool: another tool falls through, it does not inherit", () => {
      // The map is keyed on the tool for a reason. Handing `cursor` the path to
      // `claude` because it happened to be the only entry would be the silent wrong
      // start this whole layer exists to prevent.
      expect(resolveExec({ worker: "cursor", local }).source).toBe("default");
    });

    it("the flag beats the machine — checks aim at a stub, acceptance at the real binary", () => {
      expect(resolveExec({ flag: "/tmp/stub.sh", worker: "claude-code", local })).toEqual({
        value: "/tmp/stub.sh",
        source: "flag",
      });
    });
  });

  describe("resolveAgentParams — and the door they are refused at", () => {
    it("the role's parameters travel with their source", () => {
      const resolved = resolveAgentParams({
        flags: {},
        worker: { value: "claude-code", source: "role" },
        launch: profile({ kind: "claude-code", model: "opus", effort: "high" }),
      });
      expect(resolved).toEqual({
        ok: true,
        params: {
          model: { value: "opus", source: "role" },
          effort: { value: "high", source: "role" },
        },
      });
    });

    it("a flag overrides one parameter WITHOUT resetting the other", () => {
      // The same independence the ceilings have, and the same reason: the mistake
      // would be silent — a run with the model somebody typed and an effort nobody
      // did looks exactly like a run that obeyed the config.
      const resolved = resolveAgentParams({
        flags: { model: "sonnet" },
        worker: { value: "claude-code", source: "default" },
        launch: profile({ kind: "claude-code", model: "opus", effort: "high" }),
      });
      expect(resolved).toMatchObject({
        ok: true,
        params: { model: { source: "flag" }, effort: { value: "high", source: "role" } },
      });
    });

    it("saying nothing means saying nothing — not restating the tool's default", () => {
      const resolved = resolveAgentParams({
        flags: {},
        worker: { value: "claude-code", source: "default" },
        launch: profile(),
      });
      expect(resolved).toEqual({ ok: true, params: {} });
    });

    it("REFUSES when the role's parameters were written for another tool", () => {
      const resolved = resolveAgentParams({
        flags: {},
        worker: { value: "cursor", source: "flag" },
        launch: profile({ kind: "claude-code", model: "opus" }),
      });
      expect(resolved).toMatchObject({ ok: false });
      expect((resolved as { reason: string }).reason).toContain("cursor");
    });

    it("REFUSES --model for a tool the package cannot pass it to", () => {
      const resolved = resolveAgentParams({
        flags: { model: "opus" },
        worker: { value: "cursor", source: "flag" },
      });
      expect(resolved).toMatchObject({ ok: false });
    });

    it("REFUSES an effort level outside the tool's vocabulary, and lists the levels", () => {
      // The config path is guarded by the schema; the flag path is guarded here, or
      // it would be the one way a value the tool rejects reaches the spawn.
      const resolved = resolveAgentParams({
        flags: { effort: "extreme" },
        worker: { value: "claude-code", source: "default" },
      });
      expect(resolved).toMatchObject({ ok: false });
      expect((resolved as { reason: string }).reason).toContain("xhigh");
    });
  });

  describe("what reaches the process", () => {
    it("the parameters become flags of the agent binary", () => {
      const argv = buildLaunchArgv({
        prompt: "p",
        maxTurns: "300",
        launch: profile(),
        params: {
          model: { value: "opus", source: "role" },
          effort: { value: "high", source: "flag" },
        },
      });
      expect(argv.join(" ")).toContain("--model opus");
      expect(argv.join(" ")).toContain("--effort high");
    });

    it("no parameters → no flags: the tool's own default is not ours to restate", () => {
      const argv = buildLaunchArgv({
        prompt: "p",
        maxTurns: "300",
        launch: profile(),
      });
      expect(argv).not.toContain("--model");
      expect(argv).not.toContain("--effort");
    });

    it("describeAgent names every value AND the layer it came from", () => {
      const line = describeAgent({
        worker: { value: "claude-code", source: "role" },
        exec: { value: "/opt/claude", source: "machine" },
        params: { effort: { value: "max", source: "flag" } },
      });
      expect(line).toContain("claude-code (role)");
      expect(line).toContain("exec /opt/claude (machine)");
      expect(line).toContain("effort max (flag)");
    });
  });
});

describe("continuing a session instead of starting one (R18)", () => {
  it("a resume puts --resume before the prompt and keeps the rest of the contract", () => {
    const argv = buildLaunchArgv({
      prompt: "carry on",
      maxTurns: "300",
      launch: { allowedTools: ["Bash"] },
      resume: "8f3a2b1c",
    });

    expect(argv.slice(0, 4)).toEqual(["--resume", "8f3a2b1c", "-p", "carry on"]);
    // The permissions and the stream format are not a property of freshness.
    expect(argv).toContain("--allowedTools");
    expect(argv.join(" ")).toContain("--output-format stream-json");
  });

  it("a fresh run says nothing about resuming", () => {
    expect(
      buildLaunchArgv({ prompt: "p", maxTurns: "300", launch: { allowedTools: ["Bash"] } }),
    ).not.toContain("--resume");
  });

  it("the resume prompt does NOT repeat the role card — that is what resuming saves", () => {
    const prompt = buildResumePrompt({
      thread: "016-x",
      reason: "supervisor-gone",
      deadline: "2026-07-26T15:00:00Z",
      windDownSeconds: 720,
    });

    expect(prompt).toContain("016-x");
    expect(prompt).toContain("supervisor-gone");
    expect(prompt).not.toContain("ROLE CARD");
    // The finish line is unchanged: a continued session that stops quietly would be
    // recorded as a break.
    expect(prompt).toContain("new-message");
  });

  it("the resume prompt carries the NEW deadline and the same norm of landing (R20)", () => {
    // A resumed session works under a FRESH lease with a fresh window, and the one thing
    // it cannot know by itself is when that window ends: the deadline it saw before the
    // break belonged to the lease that broke.
    const prompt = buildResumePrompt({
      thread: "016-x",
      reason: "supervisor-gone",
      deadline: "2026-07-26T16:30:00Z",
      windDownSeconds: 300,
    });

    expect(prompt).toContain("2026-07-26T16:30:00Z");
    expect(prompt).toContain("5 minutes");
    expect(prompt).toContain("commit it AS IT IS");
  });

  it("the resume prompt SENDS IT BACK TO THE THREAD — under the narrowed rule an answer may have arrived", () => {
    // The first version said "nothing has moved", which was true of the rule it
    // shipped with. Since john's narrowing a reply no longer blocks a resume, so a
    // session told "nothing has moved" would carry on straight past the message it
    // was raised to act on.
    const prompt = buildResumePrompt({
      thread: "016-x",
      reason: "stalled",
      deadline: "2026-07-26T15:00:00Z",
      windDownSeconds: 720,
    });

    expect(prompt).toContain("read its tail");
    expect(prompt).not.toContain("Nothing has moved");
    // What the guard DID verify is what it is allowed to rely on.
    expect(prompt).toContain("nobody has written in your place");
  });

  it("the launch event carries the mode, the resumed session and the world it saw", () => {
    const plan = planLaunch({
      events: [],
      role: "dev-core",
      thread: "t",
      now: NOW,
      wallClockMs: 900_000,
      continuation: { mode: "resume", session: "sid", why: "the world stood still" },
      world: { base: "commit", mine: "2026-07-24T12-00-00Z-dev-core.md" },
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const launch = plan.events.find((event) => event.kind === "launch");
    expect(launch).toEqual({
      kind: "launch",
      ts: "2026-07-24T14:00:00Z",
      role: "dev-core",
      thread: "t",
      mode: "resume",
      resumes: "sid",
      world: { base: "commit", mine: "2026-07-24T12-00-00Z-dev-core.md" },
    });
  });

  it("a fresh launch records the world too — it is what the NEXT decision compares against", () => {
    const plan = planLaunch({
      events: [],
      role: "dev-core",
      thread: "t",
      now: NOW,
      wallClockMs: 900_000,
      continuation: { mode: "fresh", why: "no previous run" },
      world: { base: "commit", mine: "2026-07-24T12-00-00Z-dev-core.md" },
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const launch = plan.events.find((event) => event.kind === "launch");
    expect(launch).toMatchObject({
      mode: "fresh",
      world: { base: "commit", mine: "2026-07-24T12-00-00Z-dev-core.md" },
    });
    expect(launch).not.toHaveProperty("resumes");
  });
});
