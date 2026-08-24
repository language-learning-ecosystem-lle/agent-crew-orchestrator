import { describe, expect, it } from "vitest";
import {
  authAlarmKey,
  type NotifyState,
  parseNotifyState,
  planNotifications,
  renderNotifyState,
} from "./notify.js";

const JOHN = { id: "john", style: "direct" } as const;
const AUTH = {
  account: "main",
  since: "2026-08-01T17:04:00Z",
  deaths: 3,
  until: "2026-08-01T17:14:00Z",
};
const GH = {
  since: "2026-08-01T10:01:00Z",
  ticks: 6,
  threshold: 5,
  refusal: "Could not resolve to a Repository with the name 'owner/repo'.",
};
const NOTHING: NotifyState = { waiting: [], stalled: [], parked: [] };

const plan = (seen: NotifyState) =>
  planNotifications({ targets: [JOHN], waiting: [], seen, auth: AUTH, gh: GH });

describe("the box's own alarms", () => {
  it("say what is wanted of the reader — the shelf and the vendor's own sentence", () => {
    const first = plan(NOTHING);
    expect(first.freshAuth).toBe(true);
    expect(first.freshGh).toBe(true);
    const text = first.lines.map((line) => line.text).join("\n");
    expect(text).toContain("cannot authenticate");
    expect(text).toContain(AUTH.until);
    expect(text).toContain(GH.refusal);
    // The threshold beside the count: "6 ticks" alone is a number nobody can judge.
    expect(text).toContain("threshold 5");
    // THE BOX COMES FIRST — a shelved box makes every line below it unactionable.
    expect(first.lines[0]?.kind).toBe("auth");
    expect(first.lines[1]?.kind).toBe("gh-outage");
  });

  // THE ALARM NAMES THE ACCOUNT AND NO VENDOR'S COMMAND (thread 026). The alarm is keyed by
  // an account and an account carries no kind, so a command spelled here can only be one
  // vendor's guess — and the operator of a shelved Codex account would be told to type a
  // login that cannot lift the shelf. Reasoning in a comment is not a door: this pins it, so
  // that pasting the repair words back in fails by name instead of shipping.
  it("names no vendor command: the repair words belong to the kind, and an account has none", () => {
    const text = plan(NOTHING)
      .lines.filter((line) => line.kind === "auth")
      .map((line) => line.text)
      .join("\n");
    // Not an empty assertion: the line it is read from is the one that DOES name the account.
    expect(text).toContain("main");
    for (const command of ["claude login", "CLAUDE_CONFIG_DIR", "codex login", "CODEX_API_KEY"])
      expect(text).not.toContain(command);
  });

  it("ONE DELIVERY PER EVENT, not one per tick: an announced shelf is not fresh again", () => {
    const state = renderNotifyState({
      waiting: [],
      stalled: [],
      parked: [],
      auth: authAlarmKey(AUTH),
      gh: GH.since,
    });
    const again = plan(parseNotifyState(state));
    expect(again.freshAuth).toBe(false);
    expect(again.freshGh).toBe(false);
    // The LINES stay: the message always says the full composition (R4), only the
    // decision to send is keyed by what is new.
    expect(again.lines).toHaveLength(2);
  });

  it("an UNCONFIRMED delivery rings again: the state was never written, so the event is still fresh", () => {
    // This is the caller's half of rule 029 seen from here — a failed transport leaves the
    // state file untouched, so the next run reads exactly the state of the first one.
    const failed = plan(NOTHING);
    expect(failed.freshAuth).toBe(true);
    expect(plan(NOTHING).freshAuth).toBe(true);
    expect(plan(NOTHING).freshGh).toBe(true);
  });

  it("a NEW shelf rings even though the previous one was announced", () => {
    const seen = parseNotifyState(
      renderNotifyState({
        waiting: [],
        stalled: [],
        parked: [],
        auth: authAlarmKey(AUTH),
        gh: GH.since,
      }),
    );
    const later = planNotifications({
      targets: [JOHN],
      waiting: [],
      seen,
      auth: { ...AUTH, since: "2026-08-01T17:14:30Z", deaths: 4 },
      gh: { ...GH, since: "2026-08-01T11:00:00Z", ticks: 5 },
    });
    expect(later.freshAuth).toBe(true);
    expect(later.freshGh).toBe(true);
  });

  it("says nothing when there is nobody human to say it to", () => {
    const nudged = planNotifications({
      targets: [{ id: "curator", style: "nudge", nudge: "john" }],
      waiting: [],
      seen: NOTHING,
      auth: AUTH,
      gh: GH,
    });
    expect(nudged.lines).toEqual([]);
    expect(nudged.freshAuth).toBe(false);
    expect(nudged.freshGh).toBe(false);
  });

  it("names WHOSE credentials died — the reader's action is a login, and it is per account", () => {
    const text = plan(NOTHING)
      .lines.map((line) => line.text)
      .join("\n");
    expect(text).toContain("account 'main'");
  });

  it("spells the login of the account's own kind once the box declares one (thread 026, П3-3)", () => {
    // THE FIFTH REPAIR SITE, CONNECTED. Until `accounts.<id>.kind` existed this line
    // could name the standstill and nothing else — an alarm keyed by an account, and an
    // account that carried no vendor. With the box saying whose the directory is, the
    // operator of a Codex account reads the command that lifts THIS shelf.
    const withKind = planNotifications({
      targets: [JOHN],
      waiting: [],
      seen: NOTHING,
      auth: { ...AUTH, repair: "CODEX_HOME=/home/j/.codex codex login --with-api-key" },
    });
    expect(withKind.lines[0]?.text).toContain("codex login --with-api-key");
    expect(withKind.lines[0]?.text).toContain("/home/j/.codex");
  });

  it("…and spells NO command when the box claimed no kind — a guessed login is worse than none", () => {
    // The regression half: a claude command printed at a Codex operator can be typed in
    // full, succeeds, and leaves the circuit exactly where it was.
    const text = plan(NOTHING)
      .lines.map((line) => line.text)
      .join("\n");
    expect(text).toContain("logs that account in on the box —");
    expect(text).not.toContain("login");
  });

  it("the box's own account is named in words, not as an empty gap", () => {
    const own = planNotifications({
      targets: [JOHN],
      waiting: [],
      seen: NOTHING,
      auth: { ...AUTH, account: "" },
    });
    expect(own.lines[0]?.text).toContain("the box's own account");
  });

  it("a SECOND account with the SAME stamp rings — the key is the pair, not the stamp", () => {
    // Ф-2. Two subscriptions dying inside the same second is what a box under a token
    // outage does; keyed by `since` alone the second shelf was swallowed in silence, and
    // the operator logged in the one account that had already been named.
    const seen = parseNotifyState(
      renderNotifyState({ waiting: [], stalled: [], parked: [], auth: authAlarmKey(AUTH) }),
    );
    const other = planNotifications({
      targets: [JOHN],
      waiting: [],
      seen,
      auth: { ...AUTH, account: "second" },
    });
    expect(other.freshAuth).toBe(true);
    expect(other.lines[0]?.text).toContain("account 'second'");
    // And the same account with the same stamp still does not ring twice.
    expect(planNotifications({ targets: [JOHN], waiting: [], seen, auth: AUTH }).freshAuth).toBe(
      false,
    );
  });

  it("a state file written before B.4 reads as the box's own account, not as 'never told'", () => {
    // The upgrade must not re-ring an alarm the operator was already given: a box that
    // wrote the two-column line had one login, and that login is what its shelf was.
    const legacy = parseNotifyState("auth\t2026-08-01T17:04:00Z\n");
    expect(legacy.auth).toBe(authAlarmKey({ account: "", since: "2026-08-01T17:04:00Z" }));
    const again = planNotifications({
      targets: [JOHN],
      waiting: [],
      seen: legacy,
      auth: { ...AUTH, account: "" },
    });
    expect(again.freshAuth).toBe(false);
  });

  it("an old state file still parses, and the box keys do not disturb the others", () => {
    const state = parseNotifyState("john\t042-x\nstalled\tdev-core\t013-y\t2026-08-01T09:00:00Z\n");
    expect(state.waiting).toEqual([{ role: "john", thread: "042-x" }]);
    expect(state.auth).toBeUndefined();
    expect(state.gh).toBeUndefined();
  });
});
