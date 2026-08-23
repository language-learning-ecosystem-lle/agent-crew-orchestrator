import { describe, expect, it } from "vitest";
import {
  AUTH_SHELF_MINUTES,
  type AuthShelf,
  authAlarmDue,
  authRefusalRecorded,
  authShelfAgainst,
  authSignalOf,
  describeAuthRelease,
  describeAuthShelf,
  openAuthShelves,
} from "./auth.js";
import { CODEX } from "./codex.js";
import { observeStep } from "./observe.js";
import { planTick } from "./tick.js";

const at = (ts: string) => new Date(ts);
const released = (ts: string, reason: string, role = "dev-core") => ({
  kind: "lease-released",
  ts,
  role,
  thread: "023-daemon-parallelism",
  reason,
});

describe("authSignalOf — the tool's refusal, and only where the tool speaks", () => {
  it("reads the launcher's own line (not stream JSON at all — the shape of the episode)", () => {
    const signal = authSignalOf("Failed to authenticate. Please run /login");
    expect(signal?.evidence).toContain("Failed to authenticate");
  });

  it("reads the result event's own text", () => {
    const line = JSON.stringify({ type: "result", result: "API Error: authentication_error" });
    expect(authSignalOf(line)).toBeDefined();
  });

  it("does NOT read the session's own payload — the lesson of 30.07, inherited", () => {
    // A tool_result carrying a file of THIS package: the phrase is in the source above.
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", content: "const AUTH = /failed to authenticate/i" }],
      },
    });
    expect(authSignalOf(line)).toBeUndefined();
  });

  it("does NOT fire on a refusal of PERMISSION — the credentials worked there", () => {
    expect(authSignalOf("permission_error: this tool call was denied")).toBeUndefined();
    expect(authSignalOf("HTTP 403: Resource not accessible by integration")).toBeUndefined();
  });

  it("says in its own line that the pair is not moving towards 'exhausted'", () => {
    expect(describeAuthRelease({ evidence: "Failed to authenticate" })).toContain(
      "does NOT count as a failed attempt",
    );
  });
});

describe("observeStep — an auth death is its own outcome, not a pair's failure", () => {
  it("records 'auth-failed' where it would have recorded 'exited-without-handoff'", () => {
    const step = observeStep("running", { handedOff: false, processExited: true, overdue: false });
    expect(step).toEqual({ record: "lease-released", reason: "exited-without-handoff" });

    const withAuth = observeStep("running", {
      handedOff: false,
      processExited: true,
      overdue: false,
      authFailed: true,
    });
    expect(withAuth).toEqual({ record: "lease-released", reason: "auth-failed" });
  });

  it("yields to the quota when both are somehow true — the vendor's own statement wins", () => {
    expect(
      observeStep("running", {
        handedOff: false,
        processExited: true,
        overdue: false,
        quotaExhausted: true,
        authFailed: true,
      }),
    ).toEqual({ record: "lease-released", reason: "quota-exhausted" });
  });

  it("yields to a handoff — a run that passed the turn before dying succeeded", () => {
    expect(
      observeStep("running", {
        handedOff: true,
        processExited: true,
        overdue: false,
        authFailed: true,
      }),
    ).toEqual({ record: "handoff-detected" });
  });
});

describe("openAuthShelves — a shelf per account, folded out of the journal", () => {
  /**
   * The box's OWN account, which is what every event of these fixtures carries by saying
   * nothing (`BOX_ACCOUNT`). The tests below are the pre-B.3 behaviour and are kept
   * verbatim: one login, one shelf. What the fold does with SEVERAL is the subject of its
   * own describe further down.
   */
  const openAuthShelf = (events: Parameters<typeof openAuthShelves>[0], now: Date) =>
    openAuthShelves(events, now)[0];
  const events = [released("2026-08-01T17:00:00Z", "auth-failed")];

  it("closes the box for its interval and reopens by the clock", () => {
    const shelf = openAuthShelf(events, at("2026-08-01T17:05:00Z"));
    expect(shelf?.until).toBe("2026-08-01T17:10:00Z");
    expect(AUTH_SHELF_MINUTES).toBe(10);
    expect(openAuthShelf(events, at("2026-08-01T17:11:00Z"))).toBeUndefined();
  });

  it("counts the RUN of deaths across roles — the credentials are one per box", () => {
    const shelf = openAuthShelf(
      [
        released("2026-08-01T17:00:00Z", "auth-failed", "dev-core"),
        released("2026-08-01T17:10:00Z", "auth-failed", "curator"),
      ],
      at("2026-08-01T17:15:00Z"),
    );
    expect(shelf?.deaths).toBe(2);
    expect(shelf?.role).toBe("curator");
  });

  it("is broken by any other completed run — that box proved it can authenticate", () => {
    const shelf = openAuthShelf(
      [
        released("2026-08-01T17:00:00Z", "auth-failed"),
        released("2026-08-01T17:02:00Z", "completed"),
      ],
      at("2026-08-01T17:05:00Z"),
    );
    expect(shelf).toBeUndefined();
  });

  it("rings only when the outage is one — a single death is not an alarm", () => {
    const once = openAuthShelf(events, at("2026-08-01T17:05:00Z"));
    expect(authAlarmDue(once as NonNullable<typeof once>)).toBe(false);
    const twice = openAuthShelf(
      [
        released("2026-08-01T17:00:00Z", "auth-failed"),
        released("2026-08-01T17:05:00Z", "auth-failed"),
      ],
      at("2026-08-01T17:06:00Z"),
    );
    expect(authAlarmDue(twice as NonNullable<typeof twice>)).toBe(true);
    expect(describeAuthShelf(twice as NonNullable<typeof twice>)).toContain("claude login");
    // THE REPAIR IS THE KIND'S SENTENCE (thread 026, step 3, point 3): the same shelf on a
    // role raised as codex dictates the codex login, and NOT `claude login` — a command an
    // operator can type in full while the circuit stays exactly where it was.
    const onCodex = describeAuthShelf(twice as NonNullable<typeof twice>, CODEX);
    expect(onCodex).toContain("codex login --with-api-key");
    expect(onCodex).not.toContain("claude login");
  });

  it("writes one journal line per shelf, not one per tick", () => {
    const shelf = openAuthShelf(events, at("2026-08-01T17:05:00Z")) as NonNullable<AuthShelf>;
    expect(authRefusalRecorded(events, shelf)).toBe(false);
    const withRecord = [
      ...events,
      {
        kind: "launch-refused",
        ts: "2026-08-01T17:01:00Z",
        role: "dev-core",
        thread: "023-daemon-parallelism",
        reason: "auth",
      },
    ];
    expect(authRefusalRecorded(withRecord, shelf)).toBe(true);
  });
});

describe("planTick — a shelved box raises nobody, and says which shelf", () => {
  const candidates = [{ role: "dev-core", thread: "023-daemon-parallelism" }];
  const base = { enabled: true, stopped: false, candidates, now: at("2026-08-01T17:05:00Z") };

  it("refuses every candidate on the credentials shelf", () => {
    const decision = planTick({
      ...base,
      events: [released("2026-08-01T17:00:00Z", "auth-failed")] as never,
    });
    expect(decision.kind).toBe("auth");
    expect(decision.skipped.map((skip) => skip.reason)).toEqual(["auth"]);
    if (decision.kind !== "auth") throw new Error("unreachable");
    expect(decision.cut?.reason).toBe("auth");
    expect(decision.shelf.deaths).toBe(1);
  });

  it("raises as usual once the shelf has run out — the next launch IS the probe", () => {
    const decision = planTick({
      ...base,
      events: [released("2026-08-01T17:00:00Z", "auth-failed")] as never,
      now: at("2026-08-01T17:11:00Z"),
    });
    expect(decision.kind).toBe("plan");
  });
});

/**
 * B.3 (thread 055) — A SHELF PER ACCOUNT, and the half that is sharper than the quota's:
 * the RUN OF DEATHS. With one shelf a healthy account delivering every ten minutes reset
 * the counter of a dead one on every tick, so `authAlarmDue` (threshold 2) would never
 * ring and the box would stand still on a token nobody was told about.
 */
describe("openAuthShelves — the credentials are the account's (055, B.3)", () => {
  const died = (ts: string, account?: string, role = "dev-core") => ({
    kind: "lease-released",
    ts,
    role,
    thread: "055-x",
    reason: "auth-failed",
    ...(account === undefined ? {} : { account }),
  });
  const delivered = (ts: string, account?: string, role = "curator") => ({
    kind: "lease-released",
    ts,
    role,
    thread: "055-y",
    reason: "completed",
    ...(account === undefined ? {} : { account }),
  });

  it("shelves each account separately — one dead token does not close the other's door", () => {
    const shelves = openAuthShelves(
      [died("2026-08-01T17:00:00Z", "main")],
      at("2026-08-01T17:05:00Z"),
    );
    expect(shelves.map((shelf) => shelf.account)).toEqual(["main"]);
    expect(authShelfAgainst(shelves, "second")).toBeUndefined();
    expect(authShelfAgainst(shelves, "main")?.deaths).toBe(1);
  });

  it("a delivery on ANOTHER account does not break the run of deaths — the alarm still rings", () => {
    const shelves = openAuthShelves(
      [
        died("2026-08-01T17:00:00Z", "main"),
        delivered("2026-08-01T17:01:00Z", "second"),
        died("2026-08-01T17:02:00Z", "main"),
      ],
      at("2026-08-01T17:05:00Z"),
    );
    const shelf = authShelfAgainst(shelves, "main");
    expect(shelf?.deaths).toBe(2);
    expect(authAlarmDue(shelf as AuthShelf)).toBe(true);
  });

  it("…while a delivery on the SAME account still breaks it — that is what proves the token", () => {
    const shelves = openAuthShelves(
      [
        died("2026-08-01T17:00:00Z", "main"),
        delivered("2026-08-01T17:01:00Z", "main"),
        died("2026-08-01T17:02:00Z", "main"),
      ],
      at("2026-08-01T17:05:00Z"),
    );
    expect(authShelfAgainst(shelves, "main")?.deaths).toBe(1);
  });

  it("an event with no account is the box's own login, which is where it spent", () => {
    const shelves = openAuthShelves([died("2026-08-01T17:00:00Z")], at("2026-08-01T17:05:00Z"));
    expect(authShelfAgainst(shelves, undefined)?.deaths).toBe(1);
    expect(authShelfAgainst(shelves, "main")).toBeUndefined();
  });

  it("names WHOSE credentials in the line an operator acts on", () => {
    const shelves = openAuthShelves(
      [died("2026-08-01T17:00:00Z", "second"), died("2026-08-01T17:02:00Z", "second")],
      at("2026-08-01T17:05:00Z"),
    );
    expect(describeAuthShelf(shelves[0] as AuthShelf)).toContain("account 'second'");
  });
});
