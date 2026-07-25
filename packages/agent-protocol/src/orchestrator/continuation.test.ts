/**
 * The continuation policy (R18). Fresh is always correct and resume is correct only
 * under three conditions — so the tests are, deliberately, mostly about the paths
 * that end in `fresh`: every one of them is a place where a resume would have carried
 * a session into a world it does not know it is in.
 */
import { describe, expect, it } from "vitest";

import {
  describeContinuation,
  planContinuation,
  previousRun,
  YOUNG_RUN_STEPS,
} from "./continuation.js";
import type { OrchestratorEvent } from "./journal.js";

const WORLD = { thread: "aaa", base: "bbb" };
const SESSION = "8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b";

const broken = (over: Partial<Parameters<typeof planContinuation>[0]["previous"]> = {}) => ({
  reason: "supervisor-gone" as const,
  session: SESSION,
  steps: 12,
  world: WORLD,
  ...over,
});

describe("reading the last run off the journal", () => {
  const events = (kinds: readonly OrchestratorEvent[]): readonly OrchestratorEvent[] => kinds;

  it("takes the LAST run of the pair, not the first", () => {
    const base = { ts: "2026-07-25T10:00:00Z", role: "dev-core", thread: "016-x" };
    const previous = previousRun(
      events([
        { kind: "lease-acquired", ...base, deadline: "2026-07-25T11:00:00Z" },
        { kind: "launch", ...base, mode: "fresh", world: { thread: "old", base: "old" } },
        { kind: "lease-released", ...base, reason: "timeout", steps: 200 },
        { kind: "lease-acquired", ...base, deadline: "2026-07-25T12:00:00Z" },
        { kind: "launch", ...base, mode: "fresh", world: WORLD },
        { kind: "lease-released", ...base, reason: "stalled", session: SESSION, steps: 9 },
      ]),
      "dev-core",
      "016-x",
    );

    expect(previous).toEqual({ reason: "stalled", session: SESSION, steps: 9, world: WORLD });
  });

  it("ignores the other pairs entirely", () => {
    const previous = previousRun(
      events([
        {
          kind: "lease-acquired",
          ts: "2026-07-25T10:00:00Z",
          role: "dev-speech",
          thread: "016-x",
          deadline: "2026-07-25T11:00:00Z",
        },
      ]),
      "dev-core",
      "016-x",
    );

    expect(previous).toBeUndefined();
  });

  it("a run still in flight has no reason yet — and is therefore not resumable", () => {
    const base = { ts: "2026-07-25T10:00:00Z", role: "dev-core", thread: "016-x" };
    const previous = previousRun(
      events([
        { kind: "lease-acquired", ...base, deadline: "2026-07-25T11:00:00Z" },
        { kind: "launch", ...base, world: WORLD },
      ]),
      "dev-core",
      "016-x",
    );

    expect(previous?.reason).toBeNull();
    expect(
      planContinuation({ ...(previous === undefined ? {} : { previous }), world: WORLD }).mode,
    ).toBe("fresh");
  });
});

describe("the three conditions", () => {
  it("all of them met → resume, and the line says which session and why", () => {
    const decision = planContinuation({ previous: broken(), world: WORLD });

    expect(decision).toEqual({
      mode: "resume",
      session: SESSION,
      why: expect.stringContaining("external"),
    });
    expect(describeContinuation(decision)).toContain(SESSION);
  });

  it("1. exhaustion is NOT an external abort: a timeout resumes into the same tightness", () => {
    for (const reason of ["timeout", "exited-without-handoff", "forced", "exhausted"] as const) {
      expect(planContinuation({ previous: broken({ reason }), world: WORLD }).mode).toBe("fresh");
    }
  });

  it("2. the thread moved → fresh: a resumed session does not re-read what it has read", () => {
    const decision = planContinuation({
      previous: broken(),
      world: { ...WORLD, thread: "something-else" },
    });

    expect(decision).toEqual({ mode: "fresh", why: expect.stringContaining("thread has moved") });
  });

  it("2. the base branch moved → fresh: its work would sit on a premise that is gone", () => {
    const decision = planContinuation({
      previous: broken(),
      world: { ...WORLD, base: "merged-since" },
    });

    expect(decision).toEqual({ mode: "fresh", why: expect.stringContaining("base branch") });
  });

  it("3. a long run is not resumed — the context it brings back is what got tight", () => {
    expect(
      planContinuation({ previous: broken({ steps: YOUNG_RUN_STEPS }), world: WORLD }).mode,
    ).toBe("fresh");
    expect(
      planContinuation({ previous: broken({ steps: YOUNG_RUN_STEPS - 1 }), world: WORLD }).mode,
    ).toBe("resume");
  });
});

describe("everything unknown falls to fresh", () => {
  it("no previous run at all", () => {
    expect(planContinuation({ world: WORLD }).mode).toBe("fresh");
  });

  it("a break with no session id recorded — there is nothing to resume", () => {
    const { session: _id, ...previous } = broken();
    expect(planContinuation({ previous, world: WORLD }).mode).toBe("fresh");
  });

  it("a journal written before R18: no world on the launch line", () => {
    // Backfilling it would mean inventing what an old run saw — the one thing the
    // policy must never be given.
    const { world: _world, ...previous } = broken();
    expect(planContinuation({ previous, world: WORLD }).mode).toBe("fresh");
  });

  it("the world of TODAY could not be read (a thread not committed yet, no workdir)", () => {
    expect(planContinuation({ previous: broken() }).mode).toBe("fresh");
  });

  it("how much the previous run burned was not recorded", () => {
    const { steps: _steps, ...previous } = broken();
    expect(planContinuation({ previous, world: WORLD }).mode).toBe("fresh");
  });

  it("--fresh beats every condition, including a perfectly resumable one", () => {
    const decision = planContinuation({ previous: broken(), world: WORLD, forceFresh: true });

    expect(decision).toEqual({ mode: "fresh", why: "--fresh was given" });
  });
});

describe("the decision is printable", () => {
  it("both modes name their reason — a policy nobody can audit spends money in silence", () => {
    expect(describeContinuation({ mode: "fresh", why: "the base branch has moved on" })).toBe(
      "fresh: the base branch has moved on",
    );
    expect(
      describeContinuation({ mode: "resume", session: "s", why: "the world stood still" }),
    ).toBe("resume s: the world stood still");
  });
});
