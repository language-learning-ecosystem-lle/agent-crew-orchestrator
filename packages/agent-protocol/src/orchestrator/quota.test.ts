import { describe, expect, it } from "vitest";
import { type OrchestratorEvent, parseEventLine, renderEventLine } from "./journal.js";
import { consecutiveLaunchesWithoutDelivery, planLaunch } from "./launch.js";
import { foldLeases } from "./lease.js";
import { observeStep } from "./observe.js";
import {
  BOX_ACCOUNT,
  describeAccount,
  describeQuotaPause,
  describeQuotaRelease,
  describeQuotaShelf,
  minutesLeftOnShelf,
  openQuotaShelves,
  type QuotaShelf,
  quotaRefusalRecorded,
  quotaSignalOf,
  SHORT_SHELF_MINUTES,
  shelfEndOfRefusal,
  shelvesAgainst,
  UNKNOWN_WINDOW,
  windowBoundaryOf,
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

  it("three quota releases do NOT exhaust the pair, and cost it no count either", () => {
    // Three ordinary failures do — that is the ceiling working. The whole point of
    // finding C is that these three are not that.
    //
    // THE COUNT CHANGED HERE IN THREAD 019 (§4) and the change is deliberate: this line
    // used to expect `3`, which recorded what the fold DID rather than what the sentence
    // above it says. The verdict was already right; the counter was moved by the acquire
    // that opened each quota round and never moved back, so the frame said `attempt 3/3`
    // about a pair that had spent nothing. Now the round is undone with the release.
    const view = foldLeases(window(3), new Date("2026-07-29T13:00:00Z"))[0];
    expect(view?.attempt).toBe(0);
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
    expect(describeQuotaShelf(shelf as QuotaShelf, LATER)).toContain("did NOT say when it reopens");
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
    account: BOX_ACCOUNT,
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

/**
 * B.3 (thread 055) — THE SHELF IS KEYED BY (ACCOUNT, WINDOW). The pre-B.3 fold kept one
 * shelf per window for the whole box, which on a machine raising roles on two
 * subscriptions files the closed window of one against the quota of both.
 */
describe("openQuotaShelves — a shelf per account (055, B.3)", () => {
  const closedOn = (account: string | undefined, ts: string, until: string) =>
    ({
      kind: "lease-released",
      ts,
      role: "dev-core",
      thread: "055-x",
      reason: "quota-exhausted",
      window: "five_hour",
      until,
      ...(account === undefined ? {} : { account }),
    }) as const;

  const NOW = new Date("2026-07-29T13:00:00Z");

  it("the same window on two accounts is TWO shelves, not one overwriting the other", () => {
    const shelves = openQuotaShelves(
      [
        closedOn("main", "2026-07-29T12:00:00Z", "2026-07-29T17:00:00Z"),
        closedOn("second", "2026-07-29T12:30:00Z", "2026-07-29T17:30:00Z"),
      ],
      NOW,
    );
    expect(shelves.map((shelf) => shelf.account)).toEqual(["main", "second"]);
  });

  it("`shelvesAgainst` answers about ONE account and never falls back to another", () => {
    const shelves = openQuotaShelves(
      [closedOn("main", "2026-07-29T12:00:00Z", "2026-07-29T17:00:00Z")],
      NOW,
    );
    expect(shelvesAgainst(shelves, "main")).toHaveLength(1);
    expect(shelvesAgainst(shelves, "second")).toHaveLength(0);
    expect(shelvesAgainst(shelves, undefined)).toHaveLength(0);
  });

  it("silence is the box's own account — a journal written before B.3 shelves where it spent", () => {
    const shelves = openQuotaShelves(
      [closedOn(undefined, "2026-07-29T12:00:00Z", "2026-07-29T17:00:00Z")],
      NOW,
    );
    expect(shelves[0]?.account).toBe(BOX_ACCOUNT);
    expect(shelvesAgainst(shelves, undefined)).toHaveLength(1);
    expect(shelvesAgainst(shelves, BOX_ACCOUNT)).toHaveLength(1);
  });

  it("says WHOSE window closed — two accounts standing down at once is unreadable without it", () => {
    const shelves = openQuotaShelves(
      [closedOn("second", "2026-07-29T12:00:00Z", "2026-07-29T17:00:00Z")],
      NOW,
    );
    expect(describeQuotaShelf(shelves[0] as QuotaShelf, NOW)).toContain("account 'second'");
    expect(describeAccount(BOX_ACCOUNT)).toContain("box's own");
  });

  it("the account rides through the JSONL of the journal", () => {
    const line = renderEventLine({
      kind: "lease-released",
      ts: "2026-07-29T12:00:00Z",
      role: "dev-core",
      thread: "055-x",
      reason: "quota-exhausted",
      account: "second",
    } as OrchestratorEvent);
    const back = parseEventLine(line);
    expect(back.kind === "lease-released" && back.account).toBe("second");
  });
});

/* ── THREAD 019: THE BOUNDARY THE VENDOR STATES BEFORE THE WINDOW CLOSES ──────────── */

/** The shape measured on a live consumer's box, 2026-08-21 — every session's first frames. */
const boundaryFrame = (status: string, window: string, epoch: number): string =>
  JSON.stringify({
    type: "rate_limit_event",
    rate_limit_info: {
      status,
      resetsAt: epoch,
      rateLimitType: window,
      overageStatus: "rejected",
      isUsingOverage: false,
    },
    uuid: "23f09058-a2b2-41e1-831e-28caa7bb38e6",
    session_id: "82b65192-eaa9-4f1e-8c00-26e92cec5256",
  });

/** 2026-07-29T17:00:00Z and 2026-08-04T12:00:00Z, as the vendor sends them (epoch seconds). */
const FIVE_HOUR_END = Math.floor(new Date("2026-07-29T17:00:00Z").getTime() / 1000);
const SEVEN_DAY_END = Math.floor(new Date("2026-08-04T12:00:00Z").getTime() / 1000);

describe("windowBoundaryOf — the reset time is stated on EVERY turn, closed or open", () => {
  it("reads the boundary off a PERMITTING event — the live shape of a consumer's box", () => {
    expect(windowBoundaryOf(boundaryFrame("allowed", "five_hour", FIVE_HOUR_END))).toEqual({
      window: "five_hour",
      resetsAt: "2026-07-29T17:00:00Z",
    });
  });

  it("a permitting event is a boundary and NOT a closure — it opens no shelf", () => {
    // The whole safety of this reading. `resetsAt` on `allowed` says when the current
    // window rolls over; shelving on it would stand the box down permanently.
    const line = boundaryFrame("allowed", "five_hour", FIVE_HOUR_END);
    expect(windowBoundaryOf(line)).toBeDefined();
    expect(quotaSignalOf(line)).toBeUndefined();
  });

  it("a refusing event states its boundary too", () => {
    expect(windowBoundaryOf(boundaryFrame("exceeded", "seven_day", SEVEN_DAY_END))).toEqual({
      window: "seven_day",
      resetsAt: "2026-08-04T12:00:00Z",
    });
  });

  it("nothing to read is `undefined` — prose, other events, a broken epoch", () => {
    expect(windowBoundaryOf("Claude AI usage limit reached|1785340800")).toBeUndefined();
    expect(windowBoundaryOf(JSON.stringify({ type: "assistant" }))).toBeUndefined();
    expect(
      windowBoundaryOf(
        JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }),
      ),
    ).toBeUndefined();
  });
});

describe("shelfEndOfRefusal — a timeless refusal ends at the vendor's boundary, not at a guess", () => {
  const NOW_AT_REFUSAL = new Date("2026-07-29T12:05:00Z");
  const fiveHour = { window: "five_hour", resetsAt: "2026-07-29T17:00:00Z" } as const;
  const sevenDay = { window: "seven_day", resetsAt: "2026-08-04T12:00:00Z" } as const;

  it("the refusal's own time wins over everything observed earlier", () => {
    expect(
      shelfEndOfRefusal({
        signal: { resetsAt: "2026-07-29T16:00:00Z", window: "five_hour", evidence: "x" },
        boundaries: [fiveHour],
        now: NOW_AT_REFUSAL,
      }),
    ).toBe("2026-07-29T16:00:00Z");
  });

  it("a refusal that named its window takes THAT window's boundary", () => {
    expect(
      shelfEndOfRefusal({
        signal: { window: "seven_day", evidence: "x" },
        boundaries: [fiveHour, sevenDay],
        now: NOW_AT_REFUSAL,
      }),
    ).toBe("2026-08-04T12:00:00Z");
  });

  it("a prose refusal names no window — the EARLIEST boundary, never the longest", () => {
    // A seven-day boundary standing the box down for a week on a refusal that never
    // said which window it was is the expensive direction; one wasted launch is the
    // cheap one, and it re-signals and re-shelves immediately.
    expect(
      shelfEndOfRefusal({
        signal: { evidence: "rate_limit_error" },
        boundaries: [sevenDay, fiveHour],
        now: NOW_AT_REFUSAL,
      }),
    ).toBe("2026-07-29T17:00:00Z");
  });

  it("a boundary already in the past is no answer — the short default stands", () => {
    expect(
      shelfEndOfRefusal({
        signal: { evidence: "rate_limit_error" },
        boundaries: [{ window: "five_hour", resetsAt: "2026-07-29T11:00:00Z" }],
        now: NOW_AT_REFUSAL,
      }),
    ).toBeUndefined();
  });

  it("nothing observed at all — the short default stands, exactly as before", () => {
    expect(
      shelfEndOfRefusal({
        signal: { evidence: "rate_limit_error" },
        boundaries: [],
        now: NOW_AT_REFUSAL,
      }),
    ).toBeUndefined();
  });

  it("the shelf that comes out of it ends at the vendor's time and is marked as stated", () => {
    // The end of the road this function is on: the `until` it produces is what the fold
    // reads, so the pause lasts until the window reopens instead of five minutes.
    const until = shelfEndOfRefusal({
      signal: { window: "five_hour", evidence: "rate_limit_error" },
      boundaries: [fiveHour],
      now: NOW_AT_REFUSAL,
    });
    const shelf = openQuotaShelves(
      [closed({ window: "five_hour", ...(until === undefined ? {} : { until }) })],
      LATER,
    )[0];
    expect(shelf?.until).toBe("2026-07-29T17:00:00Z");
    expect(shelf?.stated).toBe(true);
  });
});

describe("a rate-limit death is external whatever the session had already done (thread 019)", () => {
  it("the quota release does not look at the step count — 200 steps is still not an attempt", () => {
    const events = [
      at("2026-07-29T12:00:00Z", "lease-acquired", { deadline: "2026-07-29T12:59:00Z" }),
      at("2026-07-29T12:40:00Z", "lease-released", { reason: "quota-exhausted", steps: 200 }),
      at("2026-07-29T13:00:00Z", "lease-acquired", { deadline: "2026-07-29T13:59:00Z" }),
      at("2026-07-29T13:40:00Z", "lease-released", { reason: "quota-exhausted", steps: 240 }),
      at("2026-07-29T14:00:00Z", "lease-acquired", { deadline: "2026-07-29T14:59:00Z" }),
      at("2026-07-29T14:40:00Z", "lease-released", { reason: "quota-exhausted", steps: 180 }),
    ];
    const view = foldLeases(events, new Date("2026-07-29T15:00:00Z"))[0];
    expect(view?.exhausted).toBe(false);
  });

  it("the round the vendor ended is UNDONE — a pair at 2/3 comes out of the window at 2/3", () => {
    // The counter, not just the verdict (thread 019, §4). `quota-exhausted` was already
    // excluded from the FAILURE test, but the `lease-acquired` that opened the quota round
    // still moved the count, so the frame printed one attempt more than the pair had spent
    // — and after the next real break, `attempt 4/3` with no `⚠ EXHAUSTED` beside it.
    const events = [
      at("2026-07-29T10:00:00Z", "lease-acquired", { deadline: "2026-07-29T10:59:00Z" }),
      at("2026-07-29T10:40:00Z", "lease-released", { reason: "exited-without-handoff" }),
      at("2026-07-29T11:00:00Z", "lease-acquired", { deadline: "2026-07-29T11:59:00Z" }),
      at("2026-07-29T11:40:00Z", "lease-released", { reason: "exited-without-handoff" }),
      at("2026-07-29T12:00:00Z", "lease-acquired", { deadline: "2026-07-29T12:59:00Z" }),
      at("2026-07-29T12:10:00Z", "lease-released", {
        reason: "quota-exhausted",
        until: "2026-07-29T17:00:00Z",
      }),
    ];
    const view = foldLeases(events, new Date("2026-07-29T17:30:00Z"))[0];
    expect(view?.attempt).toBe(2);
    expect(view?.exhausted).toBe(false);
  });

  it("and the pair still exhausts on its OWN third break — the undo is not an amnesty", () => {
    // The control of the line above: undoing the vendor's round must not buy the pair a
    // free failure, or the ceiling would be liftable by waiting for a closed window.
    const events = [
      at("2026-07-29T10:00:00Z", "lease-acquired", { deadline: "2026-07-29T10:59:00Z" }),
      at("2026-07-29T10:40:00Z", "lease-released", { reason: "exited-without-handoff" }),
      at("2026-07-29T11:00:00Z", "lease-acquired", { deadline: "2026-07-29T11:59:00Z" }),
      at("2026-07-29T11:40:00Z", "lease-released", { reason: "exited-without-handoff" }),
      at("2026-07-29T12:00:00Z", "lease-acquired", { deadline: "2026-07-29T12:59:00Z" }),
      at("2026-07-29T12:10:00Z", "lease-released", { reason: "quota-exhausted" }),
      at("2026-07-29T13:00:00Z", "lease-acquired", { deadline: "2026-07-29T13:59:00Z" }),
      at("2026-07-29T13:40:00Z", "lease-released", { reason: "exited-without-handoff" }),
    ];
    const view = foldLeases(events, new Date("2026-07-29T14:00:00Z"))[0];
    expect(view?.attempt).toBe(3);
    expect(view?.exhausted).toBe(true);
  });

  it("`observeStep` has no step gate either — the signal alone decides", () => {
    // The control of the sentence above, at the other end of the road: whatever the run
    // had done, a stream that named the closed window releases as `quota-exhausted`.
    expect(
      observeStep("running", {
        handedOff: false,
        processExited: true,
        overdue: false,
        quotaExhausted: true,
      }),
    ).toEqual({ record: "lease-released", reason: "quota-exhausted" });
  });
});

/**
 * THE SILENCE SAYS ITS OWN NAME (thread 019, §4). The defect these guard is not a wrong
 * decision — the pause itself was right since #42 — but an unreadable one: the operator's
 * question is "why is nothing moving", and every surface answered it with a sentence that
 * opened on the vendor's word for a window and buried the reason in the middle.
 *
 * They are written against the two SHAPES of the answer (the frame's long line and the
 * courier's clause), and both are asserted to carry the marker and the time left, because
 * a marker in one surface and not the other is the divergence this exists to prevent.
 */
describe("the pause names itself: `quota-paused` and how long is left", () => {
  const shelf: QuotaShelf = {
    window: "five_hour",
    account: BOX_ACCOUNT,
    until: "2026-07-29T17:00:00Z",
    since: "2026-07-29T12:00:00Z",
    stated: true,
    role: "dev-core",
  };
  const now = new Date("2026-07-29T16:17:00Z");

  it("the long line opens with the marker and carries the ISO stamp and the minutes", () => {
    const line = describeQuotaShelf(shelf, now);
    expect(line.startsWith("quota-paused until 2026-07-29T17:00:00Z (43m left)")).toBe(true);
    // The provenance did not go anywhere — it moved behind the answer, not out of it.
    expect(line).toContain("five_hour window of the box's own account");
    expect(line).toContain("seen at 2026-07-29T12:00:00Z on dev-core");
  });

  it("the courier's clause is the same fact in a phone-sized sentence", () => {
    expect(describeQuotaPause(shelf, now)).toBe(
      "quota-paused, resumes 17:00Z (43m left) — five_hour window of the box's own account",
    );
  });

  it("the zone rides on the clock — `17:00` on a box in +03:00 is a three-hour lie", () => {
    expect(describeQuotaPause(shelf, now)).toContain("17:00Z");
  });

  it("a GUESSED end is marked as a guess in BOTH surfaces, never printed as the vendor's", () => {
    const guessed = { ...shelf, stated: false };
    expect(describeQuotaShelf(guessed, now)).toContain("did NOT say when it reopens");
    expect(describeQuotaPause(guessed, now)).toContain("our short default");
  });

  it("both surfaces name WHOSE account — two accounts standing down at once need it (B.3)", () => {
    const other = { ...shelf, account: "second" };
    expect(describeQuotaShelf(other, now)).toContain("account 'second'");
    expect(describeQuotaPause(other, now)).toContain("account 'second'");
  });

  it("the minutes round UP — forty seconds left is `1m`, never `0m`", () => {
    // `0m left` reads as "this should be over by now" and sends a hand looking for a
    // defect that is not there; the error of a whole minute the other way costs nothing.
    expect(minutesLeftOnShelf(shelf, new Date("2026-07-29T16:59:20Z"))).toBe(1);
    expect(minutesLeftOnShelf(shelf, new Date("2026-07-29T17:00:00Z"))).toBe(0);
  });

  it("a `now` past the shelf gives zero, not a negative — noise, not news", () => {
    expect(minutesLeftOnShelf(shelf, new Date("2026-07-29T17:05:00Z"))).toBe(0);
  });
});
