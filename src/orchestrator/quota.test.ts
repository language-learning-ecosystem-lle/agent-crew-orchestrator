import { describe, expect, it } from "vitest";
import { type OrchestratorEvent, parseEventLine, renderEventLine } from "./journal.js";
import { consecutiveLaunchesWithoutDelivery, planLaunch } from "./launch.js";
import { foldLeases } from "./lease.js";
import { observeStep } from "./observe.js";
import {
  describeQuotaRelease,
  describeQuotaShelf,
  openQuotaShelves,
  type QuotaShelf,
  quotaRefusalRecorded,
  quotaSignalOf,
  SHORT_SHELF_MINUTES,
  UNKNOWN_WINDOW,
} from "./quota.js";

/** A moment after every signal the shelf tests build. */
const LATER = new Date("2026-07-29T12:01:00Z");

/**
 * VERBATIM FROM THIS BOX — a `rate_limit_event` line as the stream actually writes it
 * (`.orchestrator/sessions/*.log`), only the ids shortened. The two permitting shapes
 * below are the CONTROL of this whole layer: they are not invented, they were counted
 * (`allowed` 133, `allowed_warning` 13), and a recognition that refuses on either of
 * them declares a closed window on an open one.
 */
const ALLOWED_LINE = JSON.stringify({
  type: "system",
  subtype: "rate_limit_event",
  rate_limit_info: {
    status: "allowed",
    resetsAt: 1785340800,
    rateLimitType: "five_hour",
    overageStatus: "rejected",
    isUsingOverage: false,
  },
  uuid: "078e586d",
  session_id: "552493d5",
});

const ALLOWED_WARNING_LINE = JSON.stringify({
  type: "system",
  subtype: "rate_limit_event",
  rate_limit_info: {
    status: "allowed_warning",
    resetsAt: 1785456000,
    rateLimitType: "seven_day",
    utilization: 0.76,
    isUsingOverage: false,
    surpassedThreshold: 0.75,
  },
  uuid: "078e586d",
  session_id: "552493d5",
});

/** The same event with a status that does not permit — the shape we have never seen. */
const closedLine = (info: Record<string, unknown>): string =>
  JSON.stringify({ type: "system", subtype: "rate_limit_event", rate_limit_info: info });

describe("quotaSignalOf — layer 1, the stream's own rate_limit_event", () => {
  it("a permitting status is NOT a signal — `allowed`, the line as the box writes it", () => {
    expect(quotaSignalOf(ALLOWED_LINE)).toBeUndefined();
  });

  it("`allowed_warning` is NOT a signal either — the case `status !== 'allowed'` gets wrong", () => {
    // THE CONTROL OF THE PREFIX RULE. This exact shape occurs 13 times in the logs of
    // this box, always with the window open; it is a warning that arrives long BEFORE
    // the limit. An equality test against `allowed` would refuse here — and refusing a
    // 76%-of-seven-days warning is the most expensive false positive this module has.
    expect(quotaSignalOf(ALLOWED_WARNING_LINE)).toBeUndefined();
  });

  it("a non-permitting status is a signal, and carries the vendor's own reset time", () => {
    const signal = quotaSignalOf(
      closedLine({ status: "exhausted", resetsAt: 1785340800, rateLimitType: "five_hour" }),
    );
    expect(signal?.resetsAt).toBe("2026-07-29T16:00:00Z");
    expect(signal?.evidence).toContain("status=exhausted");
    expect(signal?.evidence).toContain("window=five_hour");
  });

  it("a closed SEVEN-DAY window is a signal too, and says which window it was", () => {
    // The five-hour window is the one we hit; it is not the only one that closes, and a
    // release that did not name the window would send the reader to the wrong clock.
    const signal = quotaSignalOf(
      closedLine({ status: "rejected", resetsAt: 1785456000, rateLimitType: "seven_day" }),
    );
    expect(signal?.evidence).toContain("window=seven_day");
    expect(signal?.resetsAt).toBe("2026-07-31T00:00:00Z");
  });

  it("an event we cannot read the status of is a refusal, not permission", () => {
    // The whitelist is "we READ permission". Silence is not permission — and it is the
    // shape a vendor change would arrive in.
    const signal = quotaSignalOf(closedLine({ resetsAt: 1785340800, rateLimitType: "five_hour" }));
    expect(signal).toBeDefined();
    expect(signal?.evidence).toContain("status=(none)");
  });

  it("a closed event without a reset time names no reopening time", () => {
    const signal = quotaSignalOf(closedLine({ status: "exhausted" }));
    expect(signal).toBeDefined();
    expect(signal?.resetsAt).toBeUndefined();
  });

  it("a line mentioning the field but not parseable falls THROUGH to the prose layers", () => {
    // Not a verdict, a miss: the refusal text wrapped inside a bigger payload is exactly
    // the shape that fails to parse here, and it must still be caught below.
    expect(quotaSignalOf('half a line "rate_limit_info":{"status":')).toBeUndefined();
    expect(
      quotaSignalOf("rate_limit_info, unparseable — Claude AI usage limit reached|1785340800")
        ?.resetsAt,
    ).toBe("2026-07-29T16:00:00Z");
  });
});

describe("quotaSignalOf — the recognition", () => {
  it("the exact form yields the reopening time, from an epoch in seconds", () => {
    const signal = quotaSignalOf(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Claude AI usage limit reached|1785340800" }] },
      }),
    );
    expect(signal?.resetsAt).toBe("2026-07-29T16:00:00Z");
  });

  it("the same marker in milliseconds resolves to the same moment", () => {
    expect(quotaSignalOf("Claude AI usage limit reached|1785340800000")?.resetsAt).toBe(
      "2026-07-29T16:00:00Z",
    );
  });

  it("the loose form is recognised but names NO reopening time", () => {
    // The distinction the type carries: "closed, reopening unknown" must never be
    // rounded up into "closed until <a number we made up>".
    const signal = quotaSignalOf('{"type":"result","result":"API error: rate_limit_error"}');
    expect(signal).toBeDefined();
    expect(signal?.resetsAt).toBeUndefined();
  });

  it("a line that is not stream JSON at all is still recognised", () => {
    // The launcher's own refusal never reaches the stream format — and it is exactly
    // the case where the session never starts, so nothing else could name the cause.
    expect(quotaSignalOf("Error: rate limit exceeded, try again later")).toBeDefined();
  });

  it("an ordinary line is not a quota signal", () => {
    expect(quotaSignalOf('{"type":"assistant","message":{"content":"reading the thread"}}')).toBe(
      undefined,
    );
    expect(quotaSignalOf("")).toBeUndefined();
  });

  it("the evidence is quoted and bounded", () => {
    const signal = quotaSignalOf(`rate_limit_error ${"x".repeat(500)}`);
    expect(signal?.evidence.length).toBeLessThanOrEqual(201);
  });

  it("the release line names the reopening time and the fact it is not an attempt", () => {
    const line = describeQuotaRelease({ resetsAt: "2026-07-29T16:00:00Z", evidence: "…" });
    expect(line).toContain("2026-07-29T16:00:00Z");
    expect(line).toContain("does NOT count as a failed attempt");
    expect(describeQuotaRelease({ evidence: "…" })).toContain("did not say when");
  });
});

/**
 * THE MARKER, ASSEMBLED AT RUNTIME AND NEVER WRITTEN OUT WHOLE — the fixture that
 * cost three sessions. Spelling it as one literal would put a live grenade in this
 * file: a session reading or editing it echoes the file's text back through its own
 * stream, and until the fix below that echo was read as the tool's own refusal. The
 * pieces are inert; only the value is the marker, and only at runtime.
 */
const RESET_EPOCH = 1785340800;
const MARKER = `Claude AI usage limit reached${"|"}${RESET_EPOCH}`;

describe("the session's own payload is NOT the vendor's voice — the deaths of 30.07", () => {
  it("the marker inside a `tool_result` is not a signal — the exact shape that killed them", () => {
    // The line as the stream actually wrote it: a `user` event whose `tool_result`
    // carries the text of `run.process.test.ts`, fixtures and all. Both doors are in
    // this one line — the word the structured layer used to be gated on, and the
    // marker the prose layer then matched inside the payload.
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            content: `const QUOTA_LINE = '{"rate_limit_info":{"status":"exhausted"}}';\nconst REFUSAL = "${MARKER}";`,
          },
        ],
      },
      session_id: "b71101b5",
    });
    expect(quotaSignalOf(line)).toBeUndefined();
  });

  it("the same marker as a raw line IS a signal — the launcher half is untouched", () => {
    // The other half of the pin: the launcher gives up before a session exists, its
    // words never reach the stream format, and that is the one case where nothing
    // else could name the cause.
    expect(quotaSignalOf(MARKER)?.resetsAt).toBe("2026-07-29T16:00:00Z");
  });

  it("an ordinary stream event mentioning the field is not a verdict either", () => {
    // The named third answer at work: this parsed, it is the stream speaking, and the
    // quota is not what it is speaking about. Before the fix this line fell through to
    // the prose layers whole.
    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", content: "rate_limit_info" }] },
    });
    expect(quotaSignalOf(line)).toBeUndefined();
  });

  it("the tool's own two surfaces still carry prose — `result` and an assistant text", () => {
    expect(quotaSignalOf(JSON.stringify({ type: "result", result: MARKER }))?.resetsAt).toBe(
      "2026-07-29T16:00:00Z",
    );
    expect(
      quotaSignalOf(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: MARKER }] },
        }),
      ),
    ).toBeDefined();
  });

  it("a real closed window inside a stream event is still read — the control", () => {
    // The fix must not have bought its silence by going blind: the FIRST-HAND source
    // is the structured event, and it is judged on its own field, not on the line.
    expect(quotaSignalOf(closedLine({ status: "exhausted", resetsAt: RESET_EPOCH }))).toBeDefined();
  });
});

describe("observeStep — the quota is not an ordinary death", () => {
  it("a running session cut off by the window releases as quota-exhausted", () => {
    // THE ORDER IS THE FIX: the same signals without `quotaExhausted` produce
    // `exited-without-handoff`, which is the name that counts towards the ceiling.
    const signals = { handedOff: false, processExited: true, overdue: false };
    expect(observeStep("running", { ...signals, quotaExhausted: true })).toEqual({
      record: "lease-released",
      reason: "quota-exhausted",
    });
    expect(observeStep("running", signals)).toEqual({
      record: "lease-released",
      reason: "exited-without-handoff",
    });
  });

  it("a turn that was passed before the window shut is still a handoff", () => {
    expect(
      observeStep("running", {
        handedOff: true,
        processExited: true,
        overdue: false,
        quotaExhausted: true,
      }),
    ).toEqual({ record: "handoff-detected" });
  });

  it("a stall that came first keeps its own diagnosis", () => {
    expect(
      observeStep("running", {
        handedOff: false,
        processExited: false,
        overdue: false,
        idle: true,
        quotaExhausted: true,
      }),
    ).toEqual({ record: "lease-released", reason: "stalled" });
  });
});

const at = (ts: string, kind: "lease-acquired" | "lease-released", extra = {}): OrchestratorEvent =>
  ({ kind, ts, role: "dev-core", thread: "023-x", ...extra }) as OrchestratorEvent;

describe("the attempt ceiling — a closed window is nobody's failed attempt", () => {
  const window = (n: number): OrchestratorEvent[] =>
    Array.from({ length: n }, (_, i) => [
      at(`2026-07-29T1${i}:00:00Z`, "lease-acquired", { deadline: `2026-07-29T1${i}:59:00Z` }),
      at(`2026-07-29T1${i}:05:00Z`, "lease-released", { reason: "quota-exhausted" }),
    ]).flat();

  it("three quota releases do NOT exhaust the pair", () => {
    // Three ordinary failures do — that is the ceiling working. The whole point of
    // finding C is that these three are not that.
    const view = foldLeases(window(3), new Date("2026-07-29T13:00:00Z"))[0];
    expect(view?.attempt).toBe(3);
    expect(view?.exhausted).toBe(false);
  });

  it("the same three shaped as ordinary deaths DO exhaust it — the control", () => {
    const events = window(3).map((event) =>
      event.kind === "lease-released"
        ? ({ ...event, reason: "exited-without-handoff" } as OrchestratorEvent)
        : event,
    );
    expect(foldLeases(events, new Date("2026-07-29T13:00:00Z"))[0]?.exhausted).toBe(true);
  });

  it("the pair is not held alive by the release — the next tick may raise it", () => {
    // Nothing here should look like a live lease: the mail still waits on the role and
    // the retry is the intended behaviour. What bounds the retry is the backoff, which
    // is part 2 of D-3 and deliberately absent here.
    const view = foldLeases(window(1), new Date("2026-07-29T13:00:00Z"))[0];
    expect(view?.state).toBe("released");
    expect(view?.reason).toBe("quota-exhausted");
  });
});

describe("the run budget — a closed window is nobody's spent run", () => {
  const launch = (ts: string): OrchestratorEvent =>
    ({ kind: "launch", ts, role: "dev-core", thread: "023-x" }) as OrchestratorEvent;

  it("quota releases do not walk the global counter towards its ceiling", () => {
    // THE DEADLOCK OF 30.07, as arithmetic: ten launches, every one of them cut off by
    // the window. The budget is reset by a delivery, a delivery is made by a session,
    // and no session is raised while the budget is spent — so without this the box
    // stops for the one reason that is not its fault, and a hand has to raise the
    // ceiling to break the circle.
    const events = Array.from({ length: 10 }, (_, i) => [
      launch(`2026-07-29T1${i}:00:00Z`),
      at(`2026-07-29T1${i}:05:00Z`, "lease-released", { reason: "quota-exhausted" }),
    ]).flat();
    expect(consecutiveLaunchesWithoutDelivery(events)).toBe(0);
    expect(
      planLaunch({
        events,
        role: "dev-core",
        thread: "023-x",
        now: new Date("2026-07-29T20:00:00Z"),
        wallClockMs: 60_000,
      }).ok,
    ).toBe(true);
  });

  it("the same ten as ordinary deaths DO spend it — the control", () => {
    const events = Array.from({ length: 10 }, (_, i) => [
      launch(`2026-07-29T1${i}:00:00Z`),
      at(`2026-07-29T1${i}:05:00Z`, "lease-released", { reason: "exited-without-handoff" }),
    ]).flat();
    expect(consecutiveLaunchesWithoutDelivery(events)).toBe(10);
    expect(
      planLaunch({
        events,
        role: "dev-core",
        thread: "023-y",
        now: new Date("2026-07-29T20:00:00Z"),
        wallClockMs: 60_000,
      }),
    ).toEqual({ ok: false, reason: "run-budget" });
  });

  it("it is UNDONE, not reset — another pair's break loop keeps its history", () => {
    // A closed window is not a delivery. Zeroing on it would hand the break loop of
    // every other pair a free absolution it never earned.
    const events = [
      launch("2026-07-29T10:00:00Z"),
      at("2026-07-29T10:05:00Z", "lease-released", { reason: "exited-without-handoff" }),
      launch("2026-07-29T11:00:00Z"),
      at("2026-07-29T11:05:00Z", "lease-released", { reason: "quota-exhausted" }),
    ];
    expect(consecutiveLaunchesWithoutDelivery(events)).toBe(1);
  });
});

describe("the journal carries the reopening time", () => {
  it("a quota release with `until` round-trips through the JSONL", () => {
    const event = at("2026-07-29T12:05:00Z", "lease-released", {
      reason: "quota-exhausted",
      until: "2026-07-29T16:00:00Z",
    });
    expect(parseEventLine(renderEventLine(event))).toEqual(event);
  });

  it("a quota release without `until` is legal — the signal did not always say", () => {
    const event = at("2026-07-29T12:05:00Z", "lease-released", { reason: "quota-exhausted" });
    expect(parseEventLine(renderEventLine(event))).toEqual(event);
  });
});

/* ── PART 2: THE SHELF ────────────────────────────────────────────────────────────── */

const closed = (extra: Record<string, unknown>, ts = "2026-07-29T12:00:00Z"): OrchestratorEvent =>
  at(ts, "lease-released", { reason: "quota-exhausted", ...extra });

describe("the window is recognised WITH ITS TYPE (correction 2 — there are two windows)", () => {
  it("the structured layer carries the vendor's own word for the window", () => {
    const signal = quotaSignalOf(
      JSON.stringify({
        type: "system",
        subtype: "rate_limit_event",
        // A status outside the `allowed` prefix — the closed shape, which we have never
        // observed and therefore do not name: the whitelist is what says this is closed.
        rate_limit_info: { status: "exceeded", resetsAt: 1785340800, rateLimitType: "five_hour" },
      }),
    );
    expect(signal?.window).toBe("five_hour");
  });

  it("a prose signal names no window — it is shelved under 'unknown', not under a guess", () => {
    const signal = quotaSignalOf("Claude AI usage limit reached|1785340800");
    expect(signal?.window).toBeUndefined();
    expect(openQuotaShelves([closed({ until: "2026-07-29T16:00:00Z" })], LATER)[0]?.window).toBe(
      UNKNOWN_WINDOW,
    );
  });

  it("the shelves are SEPARATE per window — a seven-day signal does not open the five-hour door", () => {
    const shelves = openQuotaShelves(
      [
        closed({ window: "five_hour", until: "2026-07-29T17:00:00Z" }),
        closed({ window: "seven_day", until: "2026-08-04T12:00:00Z" }),
      ],
      LATER,
    );
    expect(shelves.map((s) => s.window)).toEqual(["five_hour", "seven_day"]);
    expect(shelves.map((s) => s.until)).toEqual(["2026-07-29T17:00:00Z", "2026-08-04T12:00:00Z"]);
  });
});

describe("a signal without a time gets a SHORT shelf (correction 3)", () => {
  it("no `until` → the short default, marked as ours and not the vendor's", () => {
    const shelf = openQuotaShelves([closed({ window: "five_hour" })], LATER)[0];
    expect(shelf?.until).toBe("2026-07-29T12:05:00Z");
    expect(shelf?.stated).toBe(false);
    expect(describeQuotaShelf(shelf as QuotaShelf)).toContain("did NOT say when it reopens");
  });

  it("the short shelf is MINUTES, never a made-up five hours", () => {
    expect(SHORT_SHELF_MINUTES).toBeLessThanOrEqual(15);
  });

  it("a repeat signal EXTENDS the short shelf — the last one per window wins", () => {
    const shelves = openQuotaShelves(
      [closed({ window: "five_hour" }), closed({ window: "five_hour" }, "2026-07-29T12:04:00Z")],
      LATER,
    );
    expect(shelves).toHaveLength(1);
    expect(shelves[0]?.until).toBe("2026-07-29T12:09:00Z");
  });

  it("a stated time is kept as the vendor's, not shortened", () => {
    const shelf = openQuotaShelves([closed({ until: "2026-07-29T16:00:00Z" })], LATER)[0];
    expect(shelf).toMatchObject({ until: "2026-07-29T16:00:00Z", stated: true });
  });
});

describe("the shelf ends BY THE CLOCK — a backoff is not 'exhausted' under another name", () => {
  it("past its `until` the shelf is simply gone", () => {
    const events = [closed({ window: "five_hour", until: "2026-07-29T16:00:00Z" })];
    expect(openQuotaShelves(events, new Date("2026-07-29T15:59:59Z"))).toHaveLength(1);
    expect(openQuotaShelves(events, new Date("2026-07-29T16:00:01Z"))).toHaveLength(0);
  });
});

describe("the window belongs to the ACCOUNT (correction 1)", () => {
  it("a signal from ONE role shelves the box — the fold does not filter by role", () => {
    const shelves = openQuotaShelves(
      [closed({ window: "five_hour", until: "2026-07-29T16:00:00Z" })],
      LATER,
    );
    // The role rides along as EVIDENCE (whose session brought the signal in), and the
    // shelf itself is not keyed by it: `openQuotaShelves` has no role parameter at all.
    expect(shelves[0]?.role).toBe("dev-core");
  });
});

describe("one shelf, one journal record", () => {
  const shelf = {
    window: "five_hour",
    until: "x",
    since: "2026-07-29T12:00:00Z",
    stated: true,
    role: "dev-core",
  };

  it("no refusal since the shelf opened → it has not been recorded", () => {
    expect(quotaRefusalRecorded([closed({})], shelf)).toBe(false);
  });

  it("a `launch-refused` with reason quota after the signal → recorded", () => {
    const refused = {
      kind: "launch-refused",
      ts: "2026-07-29T12:00:30Z",
      role: "dev-core",
      thread: "023",
      reason: "quota",
    } as const;
    expect(quotaRefusalRecorded([closed({}), refused], shelf)).toBe(true);
  });

  it("a refusal from BEFORE this shelf does not count — a new window is a new record", () => {
    const older = {
      kind: "launch-refused",
      ts: "2026-07-29T09:00:00Z",
      role: "dev-core",
      thread: "023",
      reason: "quota",
    } as const;
    expect(quotaRefusalRecorded([older, closed({})], shelf)).toBe(false);
  });
});

describe("the journal carries the window type", () => {
  it("a quota release with `window` round-trips through the JSONL", () => {
    const event = closed({ until: "2026-07-29T16:00:00Z", window: "seven_day" });
    expect(parseEventLine(renderEventLine(event))).toEqual(event);
  });
});
