import { describe, expect, it } from "vitest";
import { parseNotifyState, renderNotifyState } from "../notify/notify.js";
import {
  FREEZE_LETTER_TURN,
  type FrozenPair,
  freezeLetterKey,
  planFreezeLetters,
  renderFreezeLetter,
} from "./freeze-letter.js";

const SINCE = "2026-09-03T02:18:56Z";

const pair = (over: Partial<FrozenPair> = {}): FrozenPair => ({
  role: "devops",
  thread: "047-something",
  since: SINCE,
  attempts: 3,
  failureClass: "substantive",
  thaw: null,
  reason: "exited-without-handoff",
  ...over,
});

const plan = (pairs: readonly FrozenPair[], said: readonly string[] = []) =>
  planFreezeLetters({ pairs, said, ceiling: 3 });

describe("planFreezeLetters — one letter per series, and the seam it is judged on", () => {
  it("the transition into exhaustion → EXACTLY ONE letter, into the pair's own thread", () => {
    const { letters } = plan([pair()]);
    expect(letters).toHaveLength(1);
    expect(letters[0]).toMatchObject({
      role: "devops",
      thread: "047-something",
      since: SINCE,
      attempts: 3,
      ceiling: 3,
      failureClass: "substantive",
      reason: "exited-without-handoff",
    });
  });

  it("the mark of that letter is the SERIES, and it comes back to be stored", () => {
    expect(plan([pair()]).said).toEqual([freezeLetterKey(pair())]);
  });

  it("THE NEXT TICK OF THE SAME EXHAUSTION → ZERO letters", () => {
    const first = plan([pair()]);
    const second = plan([pair()], first.said);
    expect(second.letters).toEqual([]);
    // And the mark survives, or the tick after it would write a third.
    expect(second.said).toEqual(first.said);
  });

  it("a freeze that thaws by itself is NOT written about — the circuit raises that pair", () => {
    expect(
      plan([pair({ thaw: "2026-09-03T02:30:00Z", failureClass: "external" })]).letters,
    ).toEqual([]);
  });

  it("an external freeze whose backoff is SPENT is written about — nothing raises it now", () => {
    const { letters } = plan([pair({ failureClass: "external", thaw: null })]);
    expect(letters).toHaveLength(1);
    expect(letters[0]?.failureClass).toBe("external");
  });

  it("a pair in the GAP of its series says nothing, and keeps its mark alive", () => {
    const gap = pair({ failureClass: undefined, thaw: undefined });
    const said = [freezeLetterKey(gap)];
    const next = plan([gap], said);
    expect(next.letters).toEqual([]);
    expect(next.said).toEqual(said);
  });

  it("a mark whose series has left the set is dropped — the next freeze rings again", () => {
    const next = plan([], [freezeLetterKey(pair())]);
    expect(next.said).toEqual([]);
  });

  it("a NEW series of the same pair is a new letter — the key carries the stamp", () => {
    const later = pair({ since: "2026-09-05T10:00:00Z" });
    const { letters } = plan([later], [freezeLetterKey(pair())]);
    expect(letters).toHaveLength(1);
    expect(letters[0]?.since).toBe("2026-09-05T10:00:00Z");
  });

  it("two frozen pairs are two letters — one fact each", () => {
    const other = pair({ role: "dev-core", thread: "056-other" });
    expect(plan([pair(), other]).letters).toHaveLength(2);
  });
});

describe("renderFreezeLetter — the four facts §2.3, and the one that is lost first", () => {
  const body = renderFreezeLetter({
    role: "devops",
    thread: "047-something",
    since: SINCE,
    attempts: 3,
    ceiling: 3,
    failureClass: "substantive",
    reason: "exited-without-handoff",
  });

  it("(1) which pair — the role and the thread", () => {
    expect(body).toContain("`devops`");
    expect(body).toContain("`047-something`");
  });

  it("(2) how many attempts, and the ceiling BESIDE the count", () => {
    expect(body).toContain("**попыток:** 3 из 3");
  });

  it("(3) how the last attempt ended, in the journal's own word", () => {
    expect(body).toContain("чем кончилась последняя попытка");
    expect(body).toContain("exited-without-handoff");
  });

  it("(4) WHAT LIFTS THE FREEZE — the hand, the command and the ceiling above it", () => {
    expect(body).toContain("Что снимает заморозку");
    expect(body).toContain(
      "orchestrator run --role devops --thread 047-something --max-attempts 4",
    );
  });

  it("and says out loud that a letter into this thread lifts nothing", () => {
    expect(body).toContain("**Письмо в этот тред заморозку НЕ снимает**");
  });

  it("a last attempt with no reason recorded is said to have none, not guessed at", () => {
    const none = renderFreezeLetter({
      role: "devops",
      thread: "047-something",
      since: SINCE,
      attempts: undefined,
      ceiling: 3,
      failureClass: "external",
      reason: null,
    });
    expect(none).toContain("в журнале не записана");
    expect(none).toContain("**попыток:** не сосчитано из 3");
  });

  it("the turn is curator's and never the frozen role's", () => {
    expect(FREEZE_LETTER_TURN).toBe("curator");
  });
});

describe("the mark through the state file — what makes the SECOND tick silent", () => {
  it("survives a render and a parse, and is kept apart from the digest's own key", () => {
    const key = freezeLetterKey(pair());
    const back = parseNotifyState(
      renderNotifyState({
        waiting: [],
        stalled: [],
        parked: [],
        freezes: [`frozen\t${key}`],
        freezeLetters: [key],
      }),
    );
    expect(back.freezeLetters).toEqual([key]);
    // The digest's memory is NOT this one: a phone that could not be reached must not make
    // the feed carry a second letter, and a letter must not swallow the phone call.
    expect(back.freezes).toEqual([`frozen\t${key}`]);
  });

  it("a state file written before this class existed reads as 'nothing was ever written'", () => {
    expect(parseNotifyState("").freezeLetters).toBeUndefined();
  });

  it("a half-written line is dropped rather than half-read", () => {
    expect(
      parseNotifyState("freeze-letter\tdevops\t047-something\n").freezeLetters,
    ).toBeUndefined();
  });
});
