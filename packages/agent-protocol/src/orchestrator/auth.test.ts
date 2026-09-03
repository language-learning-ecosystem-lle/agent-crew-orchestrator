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

/**
 * THREAD 084 — THE SHELF GOES ON THE ACCOUNT BY THE VENDOR'S REFUSAL, NOT BY ONE ROLE'S
 * FILESYSTEM.
 *
 * THE FIELD CASE, MEASURED, not supposed. `.orchestrator/journal.jsonl`, account
 * `lle-second`, 2026-09-02 15:00–19:30Z: 29 `lease-released reason=auth-failed`, ALL of
 * them role `devops` (24 on thread 070, 5 on 057), whose session was raised as system user
 * `aco-devops` and pointed at `/home/lle/.claude-lle-second` — mode `600`, owner `lle`. It
 * could not READ the credentials and was handed the vendor's `Not logged in`, which is the
 * same string a dead token prints. Behind those 29 deaths the fold refused 26 launches, and
 * 21 of the 26 belonged to `dev-core` — a role that did not fail once in the window and
 * went on delivering on the very same account between the refusals. The operator was sent
 * to `claude login` twice on credentials that were never dead.
 *
 * The two tests below are the two directions of the same door, and the second is not
 * optional: the price of being wrong the other way is a circuit that stops noticing a dead
 * token.
 */
describe("openAuthShelves — one role's refusal is not the account's (thread 084)", () => {
  const died = (ts: string, role: string, account = "lle-second") => ({
    kind: "lease-released",
    ts,
    role,
    thread: "084-x",
    reason: "auth-failed",
    account,
  });
  const delivered = (ts: string, role: string, account = "lle-second") => ({
    kind: "lease-released",
    ts,
    role,
    thread: "084-y",
    reason: "completed",
    account,
  });

  it("ONE role dying while a neighbour of the same account delivers does NOT shelve the account", () => {
    // The shape of the field case in miniature: `devops` dies twice on credentials it
    // cannot read, `dev-core` delivers on the same account in between and dies never.
    const shelves = openAuthShelves(
      [
        died("2026-09-02T16:01:56Z", "devops"),
        delivered("2026-09-02T16:03:00Z", "dev-core"),
        died("2026-09-02T16:12:33Z", "devops"),
      ],
      at("2026-09-02T16:15:00Z"),
    );
    const shelf = authShelfAgainst(shelves, "lle-second");
    expect(shelf?.scope).toBe("role");
    expect(shelf?.roles).toEqual(["devops"]);
    // THE REQUIREMENT ITSELF: the neighbour that never failed is not stood down.
    expect(authShelfAgainst(shelves, "lle-second", "dev-core")).toBeUndefined();
    expect(authShelfAgainst(shelves, "lle-second", "curator")).toBeUndefined();
    // …and the role that IS failing still is — a shelf that refuses nobody is no shelf.
    expect(authShelfAgainst(shelves, "lle-second", "devops")?.scope).toBe("role");
  });

  it("CONTROL — a refusal the vendor gave on real credentials still shelves the account", () => {
    // Two DISTINCT roles, two workspaces, two system users, one account, one refusal: the
    // only thing they share is the token, so the shelf is the account's exactly as before.
    const shelves = openAuthShelves(
      [died("2026-08-01T17:00:00Z", "dev-core"), died("2026-08-01T17:02:00Z", "curator")],
      at("2026-08-01T17:05:00Z"),
    );
    const shelf = authShelfAgainst(shelves, "lle-second");
    expect(shelf?.scope).toBe("account");
    expect(shelf?.deaths).toBe(2);
    // Every role of the account is stood down, including one that has not been raised yet.
    expect(authShelfAgainst(shelves, "lle-second", "dev-core")?.scope).toBe("account");
    expect(authShelfAgainst(shelves, "lle-second", "devops")?.scope).toBe("account");
    expect(authAlarmDue(shelf as AuthShelf)).toBe(true);
  });

  it("the same role dying twenty-nine times is still one role's evidence", () => {
    const events = Array.from({ length: 29 }, (_, i) =>
      died(`2026-09-02T16:${String(i).padStart(2, "0")}:00Z`, "devops"),
    );
    const shelf = authShelfAgainst(
      openAuthShelves(events, at("2026-09-02T16:30:00Z")),
      "lle-second",
    );
    expect(shelf?.deaths).toBe(29);
    expect(shelf?.scope).toBe("role");
  });
});

/**
 * THREAD 084, POINT 3 — THE LINE HAS TO SAY WHICH REPAIR. Half the price of the field case
 * was paid by the text: `describeAuthShelf` knew one repair, and it was the wrong one.
 */
describe("describeAuthShelf — the shelf names what it stands on (thread 084)", () => {
  const died = (ts: string, role: string) => ({
    kind: "lease-released",
    ts,
    role,
    thread: "084-x",
    reason: "auth-failed",
    account: "lle-second",
  });
  const shelfOf = (roles: readonly string[]) =>
    openAuthShelves(
      roles.map((role, i) => died(`2026-09-02T16:0${i}:00Z`, role)),
      at("2026-09-02T16:05:00Z"),
    )[0] as AuthShelf;

  it("one role refused → the line names the ROLE and refuses to send anybody to login", () => {
    const said = describeAuthShelf(shelfOf(["devops", "devops"]));
    expect(said).toContain("devops");
    expect(said).toContain("stands DOWN THAT ROLE ALONE");
    // The sentence john acted on twice, on an account whose token was alive.
    expect(said).not.toMatch(/(?<!do NOT run `)claude login/);
    expect(said).toContain("do NOT run `claude login`");
    expect(said).toContain("configDir");
  });

  it("two roles refused → the line is the old one: the credentials, and the login", () => {
    const said = describeAuthShelf(shelfOf(["devops", "dev-core"]));
    expect(said).toContain("the token is dead");
    expect(said).toContain("claude login");
    expect(said).toContain("devops, dev-core");
    expect(said).not.toContain("stands DOWN THAT ROLE ALONE");
  });

  it("the two lines are different — an operator can tell the two repairs apart", () => {
    expect(describeAuthShelf(shelfOf(["devops", "devops"]))).not.toEqual(
      describeAuthShelf(shelfOf(["devops", "dev-core"])),
    );
  });
});

/**
 * THREAD 084, THE STYCK — the fold and the planner in one breath, on the shape the journal
 * actually recorded. A unit on `openAuthShelves` proves the scope; only the planner proves
 * that the scope reaches the decision, and the decision is where the 21 refused launches of
 * 2026-09-02 were written.
 */
describe("planTick — a broken pair does not stand its account up (thread 084)", () => {
  const died = (ts: string, role: string) => ({
    kind: "lease-released",
    ts,
    role,
    thread: "070-session-tmpdir-breaks-tests",
    reason: "auth-failed",
    account: "lle-second",
  });
  const candidates = [
    { role: "devops", thread: "070-session-tmpdir-breaks-tests", account: "lle-second" },
    { role: "dev-core", thread: "056-shared-tmp-mechanism", account: "lle-second" },
  ];
  const base = { enabled: true, stopped: false, candidates, now: at("2026-09-02T16:15:00Z") };

  it("the healthy neighbour is launched while the role that keeps dying is refused", () => {
    const decision = planTick({
      ...base,
      events: [died("2026-09-02T16:12:33Z", "devops")] as never,
    });
    // NOT `auth`: the box is not standing still, it is raising the role that works.
    expect(decision.kind).toBe("plan");
    if (decision.kind !== "plan") throw new Error("unreachable");
    expect(decision.launches.map((c) => c.role)).toEqual(["dev-core"]);
    expect(decision.skipped.map((skip) => [skip.role, skip.reason])).toEqual([["devops", "auth"]]);
  });

  it("CONTROL — once a SECOND role is refused, the account stands down as it always did", () => {
    const decision = planTick({
      ...base,
      events: [
        died("2026-09-02T16:12:33Z", "devops"),
        died("2026-09-02T16:13:33Z", "dev-core"),
      ] as never,
    });
    expect(decision.kind).toBe("auth");
    if (decision.kind !== "auth") throw new Error("unreachable");
    expect(decision.shelf.scope).toBe("account");
    expect(decision.skipped.map((skip) => skip.reason)).toEqual(["auth", "auth"]);
  });
});
