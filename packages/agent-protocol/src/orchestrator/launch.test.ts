import { describe, expect, it } from "vitest";

import type { Role } from "../roles/schema.js";
import type { OrchestratorEvent } from "./journal.js";
import {
  buildLaunchPrompt,
  consecutiveLaunchesWithoutCompletion,
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
  ...over,
});

describe("roleLaunchability", () => {
  it("watch + in-repo instructions + active → запускается", () => {
    expect(roleLaunchability(role({}))).toEqual({ launchable: true });
  });

  it("wake=self (человек) → не запускается", () => {
    expect(roleLaunchability(role({ wake: { mode: "self" } }))).toEqual({
      launchable: false,
      reason: "wake-not-watch",
    });
  });

  it("wake=via-human (ассистент через человека) → не запускается", () => {
    expect(roleLaunchability(role({ wake: { mode: "via-human", via: "john" } })).launchable).toBe(
      false,
    );
  });

  it("wake=event (будит платформа) → не запускается", () => {
    expect(roleLaunchability(role({ wake: { mode: "event" } })).launchable).toBe(false);
  });

  it("нет instructions → отказ no-instructions, а не падение", () => {
    const r: Role = { ...role({}), instructions: undefined };
    expect(roleLaunchability(r)).toEqual({ launchable: false, reason: "no-instructions" });
  });

  it("instructions external (исполняется снаружи) → отказ external-instructions", () => {
    expect(
      roleLaunchability(role({ instructions: [{ kind: "external", path: "skill.md" }] })),
    ).toEqual({ launchable: false, reason: "external-instructions" });
  });

  it("status не active → отказ inactive", () => {
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
      { path: "CLAUDE.md", text: "правила проекта" },
      { path: "apps/api/CLAUDE.md", text: "правила api" },
    ],
  });

  it("несёт роль и тред", () => {
    expect(prompt).toContain("`dev-core`");
    expect(prompt).toContain("`014-x`");
  });

  it("жёстко ограничивает одним тредом", () => {
    expect(prompt).toContain("ТОЛЬКО ПО НЕМУ");
  });

  it("включает тексты всех инструкций в порядке чтения", () => {
    expect(prompt).toContain("правила проекта");
    expect(prompt).toContain("правила api");
    expect(prompt.indexOf("правила проекта")).toBeLessThan(prompt.indexOf("правила api"));
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
  it("считает launch'и, completed обнуляет", () => {
    expect(
      consecutiveLaunchesWithoutCompletion([
        launch("a", "1"),
        completed("a", "1"),
        launch("a", "2"),
        launch("a", "3"),
      ]),
    ).toBe(2);
  });

  it("петля обрыва (timeout, не completed) копится", () => {
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
  it("свежая связка → ok, события lease-acquired+launch с материализованным deadline", () => {
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

  it("связка уже running → отказ already-running (не плодим второй прогон)", () => {
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

  it("связка exhausted → отказ exhausted (потолок попыток на треде)", () => {
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

  it("глобальный потолок прогонов без completed → отказ run-budget", () => {
    const events: OrchestratorEvent[] = [];
    for (let i = 0; i < MAX_CONSECUTIVE_RUNS; i += 1) events.push(launch("x", `t${i}`));
    // другая, свежая связка — но глобальный потолок уже исчерпан
    expect(
      planLaunch({ events, role: "dev-core", thread: "fresh", now: NOW, wallClockMs: 900_000 }),
    ).toEqual({ ok: false, reason: "run-budget" });
  });

  it("потолок прогонов калибруется параметром", () => {
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
