/**
 * THE VALVE ASKS, AND WHAT IT ASKS IS THE PLANNER'S GATE (thread 177, §3.4).
 *
 * The statement of work names four outcomes, and three of them are decided in this file: the
 * pair that is raised is the NAMED one, nothing is walked around (the ceilings, the lease, the
 * hold, the park, the account's window — each refused BY NAME), and the ceiling refusal says WHO
 * is holding the places and SINCE WHEN. The fourth — the journal mark that tells a manual raise
 * from a planned one — is in `launch.test.ts`, where the event is built.
 *
 * WHY THE SUITE IS WRITTEN AGAINST THE FIELDS AND THE LINE BOTH: the fields are what a caller
 * acts on, and the line is what the operator reads. A test of the fields alone would pass on a
 * refusal that says "the ceiling of dev-core is full" without naming a single occupant, which is
 * the half of the sentence the statement of work asks for by name.
 */

import { describe, expect, it } from "vitest";
import type { OrchestratorEvent } from "./journal.js";
import { MAX_ATTEMPTS } from "./journal.js";
import { describeValveRefusal, livePairsOf, valveVerdict } from "./valve.js";

const NOW = new Date("2026-09-13T10:00:00Z");
const CEILING = { value: MAX_ATTEMPTS, source: "default" } as const;
const ONE = { pairsPerRole: 1, pairsPerInstance: undefined };
const TWO = { pairsPerRole: 2, pairsPerInstance: 3 };

const acquire = (role: string, thread: string, ts = "2026-09-13T09:40:00Z"): OrchestratorEvent => ({
  kind: "lease-acquired",
  ts,
  role,
  thread,
  deadline: "2026-09-13T12:00:00Z",
});

const ask = (over: Partial<Parameters<typeof valveVerdict>[0]> = {}) =>
  valveVerdict({
    role: "dev-core",
    thread: "177-workspace-per-pair",
    events: [],
    now: NOW,
    running: [],
    ceilings: TWO,
    ...over,
  });

describe("valveVerdict — the named pair, and nothing walked around", () => {
  it("an idle box raises the pair that was NAMED, not the head of a queue", () => {
    expect(ask({ running: [{ role: "curator", thread: "155-park", since: "09:00Z" }] })).toEqual({
      ok: true,
    });
  });

  it("the ceiling of the role is counted to the CONFIG's number, not to one", () => {
    const running = [
      { role: "dev-core", thread: "180-selfheal", since: "2026-09-13T09:10:00Z" },
      { role: "dev-core", thread: "187-journals", since: "2026-09-13T09:30:00Z" },
    ];
    // Two live pairs of this role and a ceiling of two — full.
    const full = ask({ running, ceilings: { pairsPerRole: 2, pairsPerInstance: undefined } });
    expect(full.ok).toBe(false);
    if (full.ok) return;
    expect(full.refusal.reason).toBe("role-busy");
    expect(full.refusal.ceiling).toBe(2);
    expect(full.refusal.occupants).toEqual(running);
    // …and the SAME two pairs under a ceiling of three are room, not a refusal: the number is
    // read from the config and the valve counts to it rather than to the old rule of one.
    expect(ask({ running, ceilings: { pairsPerRole: 3, pairsPerInstance: undefined } })).toEqual({
      ok: true,
    });
  });

  it("the refusal by ceiling NAMES the occupants with the time each was raised", () => {
    const full = ask({
      ceilings: ONE,
      running: [{ role: "dev-core", thread: "180-selfheal", since: "2026-09-13T09:10:00Z" }],
    });
    expect(full.ok).toBe(false);
    if (full.ok) return;
    const line = describeValveRefusal(full.refusal, CEILING);
    expect(line).toContain("the manual launch of 'dev-core×177-workspace-per-pair' is refused");
    expect(line).toContain("'role-busy'");
    expect(line).toContain("dev-core×180-selfheal since 2026-09-13T09:10:00Z");
    expect(line).toContain("'parallelism.pairsPerRole'");
  });

  it("the ceiling of the BOX refuses a role that is itself idle, and says so by its own name", () => {
    const busy = ask({
      ceilings: { pairsPerRole: 2, pairsPerInstance: 2 },
      running: [
        { role: "curator", thread: "155-park", since: "2026-09-13T09:00:00Z" },
        { role: "reviewer-pr", thread: "190-x", since: "2026-09-13T09:20:00Z" },
      ],
    });
    expect(busy.ok).toBe(false);
    if (busy.ok) return;
    expect(busy.refusal.reason).toBe("box-busy");
    expect(busy.refusal.ceiling).toBe(2);
    const line = describeValveRefusal(busy.refusal, CEILING);
    expect(line).toContain("'parallelism.pairsPerInstance'");
    expect(line).toContain("curator×155-park since 2026-09-13T09:00:00Z");
  });

  it("a live lease on the very pair named is refused as `active`, not raised on top of", () => {
    const live = ask({ events: [acquire("dev-core", "177-workspace-per-pair")] });
    expect(live.ok).toBe(false);
    if (live.ok) return;
    expect(live.refusal.reason).toBe("active");
    expect(describeValveRefusal(live.refusal, CEILING)).toContain("the pair is running right now");
  });

  it("a hold on the role refuses the valve by name — a human is in that role's chair", () => {
    const held = ask({ held: ["dev-core"] });
    expect(held.ok).toBe(false);
    if (held.ok) return;
    expect(held.refusal.reason).toBe("held");
    expect(describeValveRefusal(held.refusal, CEILING)).toContain("held by a manual session");
  });

  it("a park freezes the valve as it freezes the planner, and the line names WHOM", () => {
    const parked = ask({
      parked: new Map([["177-workspace-per-pair", "john"]]),
    });
    expect(parked.ok).toBe(false);
    if (parked.ok) return;
    expect(parked.refusal.reason).toBe("parked");
    expect(parked.refusal.parkedOn).toBe("john");
    expect(describeValveRefusal(parked.refusal, CEILING)).toContain(
      "parked behind a decision of john",
    );
  });

  it("a park of ANOTHER thread does not freeze this pair", () => {
    expect(ask({ parked: new Map([["155-park", "john"]]) })).toEqual({ ok: true });
  });

  it("the daemon's switch and brake are NOT asked: a valve is typed when the loop is off", () => {
    // Nothing in the input can say `enabled: false` or `stopped: true` — the two flags are
    // literals inside the door, and this is the test of that decision rather than of a field:
    // an idle box with no enable flag anywhere still passes the gate.
    expect(ask()).toEqual({ ok: true });
  });
});

describe("livePairsOf — who is live comes from the journal, with the time", () => {
  it("an open lease is a place taken, and it carries its stamp into the refusal", () => {
    const pairs = livePairsOf([
      {
        role: "dev-core",
        thread: "180-selfheal",
        state: "running",
        attempt: 1,
        ceiling: 3,
        deadline: "2026-09-13T12:00:00Z",
        waitDeadline: null,
        reason: null,
        lastEvent: "launch",
        lastAt: "2026-09-13T09:10:00Z",
        overdue: false,
        exhausted: false,
        launchable: false,
      },
      {
        role: "curator",
        thread: "155-park",
        state: "released",
        attempt: 0,
        ceiling: 3,
        deadline: null,
        waitDeadline: null,
        reason: "completed",
        lastEvent: "lease-released",
        lastAt: "2026-09-13T08:00:00Z",
        overdue: false,
        exhausted: false,
        launchable: true,
      },
    ]);
    expect(pairs).toEqual([
      { role: "dev-core", thread: "180-selfheal", since: "2026-09-13T09:10:00Z" },
    ]);
  });
});
