import { describe, expect, it } from "vitest";
import {
  type NotifyState,
  parseNotifyState,
  planNotifications,
  renderNotifyState,
} from "./notify.js";

const JOHN = { id: "john", style: "direct" } as const;
const AUTH = { since: "2026-08-01T17:04:00Z", deaths: 3, until: "2026-08-01T17:14:00Z" };
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

  it("ONE DELIVERY PER EVENT, not one per tick: an announced shelf is not fresh again", () => {
    const state = renderNotifyState({
      waiting: [],
      stalled: [],
      parked: [],
      auth: AUTH.since,
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
      renderNotifyState({ waiting: [], stalled: [], parked: [], auth: AUTH.since, gh: GH.since }),
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

  it("an old state file still parses, and the box keys do not disturb the others", () => {
    const state = parseNotifyState("john\t042-x\nstalled\tdev-core\t013-y\t2026-08-01T09:00:00Z\n");
    expect(state.waiting).toEqual([{ role: "john", thread: "042-x" }]);
    expect(state.auth).toBeUndefined();
    expect(state.gh).toBeUndefined();
  });
});
