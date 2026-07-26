/**
 * The continuation policy (R18). Fresh is always correct and resume is correct only
 * under three conditions — so the tests are, deliberately, mostly about the paths
 * that end in `fresh`: every one of them is a place where a resume would have carried
 * a session into a world it does not know it is in.
 *
 * The exception is the pair at the heart of john's narrowed condition 2 (2026-07-25):
 * an ANSWER from another participant must NOT block a resume, while a message written
 * for the same role by another session must. Those two are the whole point of the
 * rule, and they are asserted from both ends.
 */
import { describe, expect, it } from "vitest";

import {
  describeContinuation,
  type OwnMessage,
  planContinuation,
  previousRun,
  YOUNG_RUN_STEPS,
} from "./continuation.js";
import type { OrchestratorEvent } from "./journal.js";

const SESSION = "8f3a2b1c-0d4e-4f56-9a7b-1c2d3e4f5a6b";
/** The role's own last message when the broken run started — the mark of condition 2a. */
const MINE = "2026-07-25T10-00-00Z-dev-core.md";
const WORLD = { base: "bbb", mine: MINE };
/** What the thread holds of this role's own: the mark, and nothing after it. */
const OWN: readonly OwnMessage[] = [{ file: MINE, session: SESSION }];

const broken = (over: Partial<Parameters<typeof planContinuation>[0]["previous"]> = {}) => ({
  reason: "supervisor-gone" as const,
  session: SESSION,
  steps: 12,
  world: WORLD,
  ...over,
});

/** The world of TODAY, unchanged unless a test changes exactly one thing about it. */
const decide = (over: Partial<Parameters<typeof planContinuation>[0]> = {}) =>
  planContinuation({ previous: broken(), world: WORLD, own: OWN, ...over });

describe("reading the last run off the journal", () => {
  const events = (kinds: readonly OrchestratorEvent[]): readonly OrchestratorEvent[] => kinds;

  it("takes the LAST run of the pair, not the first", () => {
    const base = { ts: "2026-07-25T10:00:00Z", role: "dev-core", thread: "016-x" };
    const previous = previousRun(
      events([
        { kind: "lease-acquired", ...base, deadline: "2026-07-25T11:00:00Z" },
        { kind: "launch", ...base, mode: "fresh", world: { base: "old", mine: "old.md" } },
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
    expect(decide({ ...(previous === undefined ? {} : { previous }) }).mode).toBe("fresh");
  });
});

describe("the three conditions", () => {
  it("all of them met → resume, and the line says which session and why", () => {
    const decision = decide();

    expect(decision).toEqual({
      mode: "resume",
      session: SESSION,
      why: expect.stringContaining("external"),
    });
    expect(describeContinuation(decision)).toContain(SESSION);
  });

  it("1. exhaustion is NOT an external abort: a timeout resumes into the same tightness", () => {
    for (const reason of ["timeout", "exited-without-handoff", "forced", "exhausted"] as const) {
      expect(decide({ previous: broken({ reason }) }).mode).toBe("fresh");
    }
  });

  it("2. the base branch moved → fresh: its work would sit on a premise that is gone", () => {
    const decision = decide({ world: { ...WORLD, base: "merged-since" } });

    expect(decision).toEqual({ mode: "fresh", why: expect.stringContaining("base branch") });
  });

  it("3. a long run is not resumed — the context it brings back is what got tight", () => {
    expect(decide({ previous: broken({ steps: YOUNG_RUN_STEPS }) }).mode).toBe("fresh");
    expect(decide({ previous: broken({ steps: YOUNG_RUN_STEPS - 1 }) }).mode).toBe("resume");
  });
});

/**
 * john's narrowing of condition 2 (2026-07-25): the thread MOVING is not a shift —
 * being spoken for is. The first version compared the thread's tree id and refused a
 * resume on the most ordinary event there is.
 */
describe("2a — what counts as the world having moved in the thread", () => {
  it("an answer from another participant does NOT break the resume — it is the input it waited for", () => {
    // curator replied while the session was down. Nothing of this role's own changed:
    // the list below is the role's OWN messages, and the answer is not one of them.
    expect(decide({ own: OWN }).mode).toBe("resume");
  });

  it("a message written FOR THIS ROLE by another session does break it", () => {
    const decision = decide({
      own: [...OWN, { file: "2026-07-25T12-00-00Z-dev-core.md", session: "another-session-id" }],
    });

    expect(decision).toEqual({
      mode: "fresh",
      why: expect.stringContaining("another session wrote for this role"),
    });
    expect(decision.why).toContain("2026-07-25T12-00-00Z-dev-core.md");
  });

  it("a message this SAME session wrote before dying does not break it", () => {
    // The R19 shape: it asked a question in the middle of the work and was cut off
    // waiting for the answer. Refusing to continue there would kill the very case
    // continuing exists for.
    expect(
      decide({
        own: [...OWN, { file: "2026-07-25T12-00-00Z-dev-core.md", session: SESSION }],
      }).mode,
    ).toBe("resume");
  });

  it("an UNSIGNED message of this role counts as somebody else — unknown is not innocent", () => {
    // A human writing on the role's behalf, or a job: there is no session to compare,
    // and "nobody signed it" is not evidence that no one worked in its place.
    expect(decide({ own: [...OWN, { file: "2026-07-25T12-00-00Z-dev-core.md" }] }).mode).toBe(
      "fresh",
    );
  });

  it("messages of this role from BEFORE the run are not a shift — the mark bounds the interval", () => {
    // Older packages of the same role, written by long-dead sessions. Without the mark
    // they would refuse every resume in every thread the role has ever spoken in.
    expect(
      decide({
        own: [
          { file: "2026-07-20T09-00-00Z-dev-core.md", session: "an-old-session" },
          { file: MINE, session: SESSION },
        ],
      }).mode,
    ).toBe("resume");
  });

  it("the role had said nothing at launch (mine: '') — then anything of its own is new", () => {
    const world = { base: "bbb", mine: "" };

    expect(planContinuation({ previous: broken({ world }), world, own: [] }).mode).toBe("resume");
    expect(
      planContinuation({
        previous: broken({ world }),
        world,
        own: [{ file: "2026-07-25T12-00-00Z-dev-core.md", session: "another-session-id" }],
      }).mode,
    ).toBe("fresh");
  });
});

describe("everything unknown falls to fresh", () => {
  it("no previous run at all", () => {
    expect(planContinuation({ world: WORLD, own: OWN }).mode).toBe("fresh");
  });

  it("a break with no session id recorded — there is nothing to resume", () => {
    const { session: _id, ...previous } = broken();
    expect(decide({ previous }).mode).toBe("fresh");
  });

  it("a journal written before R18: no world on the launch line", () => {
    // Backfilling it would mean inventing what an old run saw — the one thing the
    // policy must never be given.
    const { world: _world, ...previous } = broken();
    expect(decide({ previous }).mode).toBe("fresh");
  });

  it("a world written by the FIRST version of R18: no mark of its own last message", () => {
    const decision = decide({ previous: broken({ world: { base: "bbb" } }) });

    expect(decision).toEqual({ mode: "fresh", why: expect.stringContaining("no mark") });
  });

  it("the mark is gone from the thread — an append-only feed that did not behave like one", () => {
    const decision = decide({ own: [{ file: "something-else.md", session: SESSION }] });

    expect(decision).toEqual({
      mode: "fresh",
      why: expect.stringContaining("no longer in the thread"),
    });
  });

  it("the thread could not be read as files at all (a legacy _thread.md)", () => {
    expect(planContinuation({ previous: broken(), world: WORLD }).mode).toBe("fresh");
  });

  it("the world of TODAY could not be read (no workdir, a thread that cannot be read)", () => {
    expect(planContinuation({ previous: broken(), own: OWN }).mode).toBe("fresh");
  });

  it("how much the previous run burned was not recorded", () => {
    const { steps: _steps, ...previous } = broken();
    expect(decide({ previous }).mode).toBe("fresh");
  });

  it("--fresh beats every condition, including a perfectly resumable one", () => {
    expect(decide({ forceFresh: true })).toEqual({ mode: "fresh", why: "--fresh was given" });
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
