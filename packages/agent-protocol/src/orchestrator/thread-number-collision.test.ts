import { describe, expect, it } from "vitest";

import { parseNotifyState, renderNotifyState } from "../notify/notify.js";
import {
  type CollisionHalf,
  collisionKeyHalves,
  collisionRings,
  collisionSaidKey,
  describeHeldNumberCollisions,
  describeQuietNumberCollisions,
  findNumberCollisions,
  NUMBER_COLLISION_SLUG,
  NUMBER_COLLISION_TURN,
  numberCollisionArgv,
  planNumberCollisionWatch,
  renderNumberCollisionLetter,
  threadNumberOf,
} from "./thread-number-collision.js";

const half = (id: string, open: boolean): { readonly id: string; readonly open: boolean } => ({
  id,
  open,
});

/**
 * ONE TICK OVER A FEED THE COURIER READ WHOLE — the shape every call of the plan has in the
 * command: the finding and the read list are folds over THE SAME threads. The tests that tell
 * a blind tick apart from a divorced pair pass the two apart on purpose, and they are the
 * only ones that do.
 */
const tick = (
  threads: readonly CollisionHalf[],
  said: readonly string[],
): ReturnType<typeof planNumberCollisionWatch> =>
  planNumberCollisionWatch({ found: findNumberCollisions(threads), threads, said });

describe("the criterion of the watchman", () => {
  it("rings on a pair one half of which is open", () => {
    const found = findNumberCollisions([
      half("144-open-threads-sweep-2", true),
      half("144-zones-comment-outlived-its-measurement", false),
      half("159-thread-number-has-no-door", true),
    ]);
    expect(found.map((collision) => collision.number)).toEqual(["144"]);
    expect(found.every(collisionRings)).toBe(true);
  });

  it("is silent on a pair both halves of which are closed — and the pair IS found", () => {
    const threads = [
      half("048-box-privileges-today", false),
      half("048-session-privileges", false),
    ];
    const found = findNumberCollisions(threads);
    // The two halves of the field acceptance: the pair is found by the search, and it is
    // rejected by the criterion. A search that missed it would look identical in the plan.
    expect(found).toHaveLength(1);
    expect(found[0]?.halves).toHaveLength(2);
    expect(collisionRings(found[0] as never)).toBe(false);
    expect(tick(threads, []).letters).toEqual([]);
    expect(describeQuietNumberCollisions({ found, ringing: [] })).toContain("048");
    expect(describeQuietNumberCollisions({ found, ringing: [] })).toContain("every half closed");
  });

  it("does NOT call a locked pair closed — the journal names WHICH silence it is", () => {
    // THE FIELD LINE OF 2026-09-09, verbatim in shape: `180` stands twice, both halves
    // `open`, the letter about it is already in the standing address and the tick is
    // therefore silent. The old line said `every half closed` about exactly this — the one
    // sentence the circuit writes about this watchman, and it named the wrong cause.
    const found = findNumberCollisions([
      half("048-box-privileges-today", false),
      half("048-session-privileges", false),
      half("180-notifier-down", true),
      half("180-selfheal-leaves-the-workspaces-behind", true),
    ]);
    const ringing = found.filter(collisionRings);
    const line = describeQuietNumberCollisions({ found, ringing });
    expect(line).not.toContain("every half closed");
    expect(line).toContain("1 still open (180)");
    expect(line).toContain(NUMBER_COLLISION_SLUG);
  });

  it("says nothing about a number carried by one thread only", () => {
    expect(findNumberCollisions([half("159-thread-number-has-no-door", true)])).toEqual([]);
  });

  it("carries THREE halves as one finding, and names all of them", () => {
    const found = findNumberCollisions([
      half("160-daemon-self-restart", false),
      half("160-merge-gate-falls-whole-on-a-forbidden-node", false),
      half("160-a-third-namesake", true),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.halves.map((entry) => entry.id)).toEqual([
      "160-a-third-namesake",
      "160-daemon-self-restart",
      "160-merge-gate-falls-whole-on-a-forbidden-node",
    ]);
    const letter = renderNumberCollisionLetter(found[0] as never);
    for (const id of found[0]?.halves.map((entry) => entry.id) ?? []) {
      expect(letter).toContain(id);
    }
  });
});

describe("what the watchman sees as a number", () => {
  it("takes the three digits of a readable thread id", () => {
    expect(threadNumberOf("159-thread-number-has-no-door")).toBe("159");
  });

  it("does NOT see what the walker of the mail does not see — the named blind spot", () => {
    // `NNN.M` is accepted by the door and invisible to the walker (thread 147), `_instances`
    // is not a thread at all. Neither is a half of any collision, because nothing is ever
    // delivered into a directory the reader does not visit.
    expect(threadNumberOf("147.1-sub-thread")).toBeUndefined();
    expect(threadNumberOf("_instances")).toBeUndefined();
    expect(
      findNumberCollisions([half("147-a-thread", true), half("147.1-sub-thread", true)]),
    ).toEqual([]);
  });
});

describe("the letter", () => {
  const found = findNumberCollisions([
    half("156-cut-the-tag-for-the-consumer", false),
    half("156-daemon-self-restart", true),
  ]);
  const letter = renderNumberCollisionLetter(found[0] as never);

  it("names the number, both halves and which of them is open", () => {
    expect(letter).toContain("156");
    expect(letter).toContain("156-cut-the-tag-for-the-consumer");
    expect(letter).toContain("156-daemon-self-restart");
    expect(letter).toMatch(/`156-daemon-self-restart` — \*\*open\*\*/);
    expect(letter).toMatch(/`156-cut-the-tag-for-the-consumer` — \*\*closed\*\*/);
  });

  it("goes into the standing address, from github, with a turn on curator", () => {
    const argv = numberCollisionArgv({ root: "/mail" });
    expect(argv).toContain("--ensure-thread");
    expect(argv[argv.indexOf("--ensure-thread") + 1]).toBe(NUMBER_COLLISION_SLUG);
    expect(argv[argv.indexOf("--from") + 1]).toBe("github");
    expect(argv[argv.indexOf("--expects") + 1]).toBe("none");
    // The turn is the whole difference between a letter that raises somebody and a note
    // nobody reads — the answer rejected at the start of thread 159.
    expect(argv[argv.indexOf("--waiting-on") + 1]).toBe(NUMBER_COLLISION_TURN);
    expect(argv).toContain("--write");
  });

  it("forwards --repo and --ref only when it was given them", () => {
    expect(numberCollisionArgv({ root: "/mail" })).not.toContain("--ref");
    expect(numberCollisionArgv({ root: "/mail", repo: "/r", ref: "origin/main" })).toContain(
      "origin/main",
    );
  });
});

describe("the lock on the repeat", () => {
  const live = [half("159-a", true), half("159-b", false)];

  it("says a standing collision ONCE, however many ticks it stands", () => {
    const first = tick(live, []);
    expect(first.letters).toHaveLength(1);
    const second = tick(live, first.said);
    expect(second.letters).toEqual([]);
    expect(second.said).toEqual(first.said);
    // And a third tick changes nothing either — silence is not a state of the feed.
    expect(tick(live, second.said).letters).toEqual([]);
  });

  /**
   * THE DIVORCE THE CIRCUIT ACTUALLY PERFORMS, and this test used to model another one. The
   * letter's own instruction is "mark the address that is invalid and name the real one in
   * both feeds; the circuit does not rename, the history of a feed is not edited" — so a
   * divorced pair is one whose invalid half is CLOSED, not one whose directory left the feed.
   *
   * The old model (`159-b` becoming `161-b` between two ticks) is a directory disappearing,
   * and that is indistinguishable from a tick that could not read it — which is the whole
   * defect of thread 203. Its price is named by the test below rather than hidden here.
   */
  it("lifts the mark when the number is divorced — and rings again if it comes back", () => {
    const said = tick(live, []).said;
    const divorced = tick([half("159-a", false), half("159-b", false)], said);
    expect(divorced.said).toEqual([]);
    expect(tick(live, divorced.said).letters).toHaveLength(1);
  });

  it("holds the mark of a pair whose half LEFT the feed — the named price of the lock", () => {
    // Nothing in this protocol deletes or renames a thread directory, so this is theory; and
    // in theory the cost is silence about a pair that no longer exists, which is the direction
    // every lock in this package fails in. A letter too few here, never a letter too many.
    const said = tick(live, []).said;
    const gone = tick([half("159-a", true), half("161-b", false)], said);
    expect(gone.letters).toEqual([]);
    expect(gone.said).toEqual(said);
    expect(gone.held.map((mark) => mark.unread)).toEqual([["159-b"]]);
  });

  it("lifts the mark when every half closes — and rings again on a reopening", () => {
    const said = tick(live, []).said;
    const quiet = tick([half("159-a", false), half("159-b", false)], said);
    expect(quiet.letters).toEqual([]);
    expect(quiet.said).toEqual([]);
    expect(tick(live, quiet.said).letters).toHaveLength(1);
  });

  it("rings again when a THIRD thread appears under a number already announced", () => {
    const said = tick(live, []).said;
    const grown = tick([...live, half("159-c", true)], said);
    expect(grown.letters).toHaveLength(1);
    expect(grown.letters[0]?.collision.halves).toHaveLength(3);
    // The old key is gone with the state it described: the pair of two no longer exists.
    expect(grown.said).toEqual([collisionSaidKey(grown.letters[0]?.collision as never)]);
  });

  /**
   * THE MARK THROUGH THE PAIR THAT STORES IT — `render` → `parse` → `plan`, the circle
   * `notify/alarms.test.ts:61` draws around the alarms, and here for the reason curator
   * measured on the diff of this PR (thread 159, msg-007 §1): the producer of the key
   * (`collisionSaidKey`, this file) and its validator (the `/^number:\d{3}:\S+$/` of
   * `parseNotifyState`) are two independent literals in two files, and NOTHING binds them
   * but the fact that they agree today.
   *
   * And the direction they fail in is the silent one: a line the validator does not accept
   * is DROPPED rather than half-read, so a drift between the two would not turn a single
   * test red — it would produce a watchman that looks like it works and writes a letter
   * about the same pair every tick, which is thread `133-tidy-letter-repeats-every-tick`
   * again. The plan alone cannot see it: it gets `said` handed to it in memory.
   */
  describe("the mark survives the state file it is stored in", () => {
    const stateOf = (said: readonly string[]): readonly string[] =>
      parseNotifyState(
        renderNotifyState({ waiting: [], stalled: [], parked: [], numberCollisions: said }),
      ).numberCollisions ?? [];

    it("the SECOND tick over the same live pair, through the file, writes nothing", () => {
      const first = tick(live, []);
      expect(first.letters).toHaveLength(1);
      // The key comes back from the file byte for byte — the validator accepts what the
      // producer makes. This is the assert the two literals are bound by.
      expect(stateOf(first.said)).toEqual(first.said);
      expect(tick(live, stateOf(first.said)).letters).toEqual([]);
    });

    it("a mark LIFTED through the file rings again when the pair comes back", () => {
      const said = stateOf(tick(live, []).said);
      // The number is divorced — both halves read, both closed: the mark leaves the plan, and
      // the file it is written into then carries nothing at all.
      const divorced = tick([half("159-a", false), half("159-b", false)], said);
      expect(stateOf(divorced.said)).toEqual([]);
      expect(tick(live, stateOf(divorced.said)).letters).toHaveLength(1);
    });

    it("a THREE-half key crosses the file too — the growth is not swallowed by the validator", () => {
      // The widest key this watchman makes: three ids joined by commas. A validator that
      // accepted only the two-half shape would drop it and say the same collision for ever.
      const grown = tick([...live, half("159-c", true)], []);
      expect(stateOf(grown.said)).toEqual(grown.said);
      expect(grown.said[0]).toBe("number:159:159-a,159-b,159-c");
    });
  });

  it("does NOT re-ring when one half of a live pair merely closes", () => {
    const said = tick(live, []).said;
    // `159-a` stays open, `159-b` was closed already: the same pair, the same statement.
    const next = tick([half("159-a", true), half("159-b", false)], said);
    expect(next.letters).toEqual([]);
  });
});

/**
 * THE TICK THAT COULD NOT LOOK — thread 203, and the road by which the repeat came back after
 * the writer of `notify.state` was fixed on 2026-09-09. `found` is a fold over the threads the
 * courier MANAGED TO READ (`loadThreads` isolates an unparsable thread into `failures` and
 * returns the rest, and a checkout caught mid-update simply yields a shorter list), so "the
 * pair is not among the findings" carried two different facts under one name: the pair stopped
 * qualifying, and the tick never saw it.
 *
 * The field shape is a pair announced once a day for days — a blind tick is rare, and every
 * one of them costs a letter into a standing address whose turn RAISES A ROLE.
 */
describe("a mark is lifted only by a pair the tick READ", () => {
  const live = [half("077-maestro-input-precondition", false), half("077-web-catches-up", true)];

  it("holds the mark when ONE half was unreadable — and says so", () => {
    const said = tick(live, []).said;
    expect(said).toEqual(["number:077:077-maestro-input-precondition,077-web-catches-up"]);
    // The tick reads everything but the closed half: under the old lock the pair was no longer
    // carried twice, the mark was dropped, and the next whole tick wrote a SECOND letter.
    const blind = tick([half("077-web-catches-up", true), half("159-other", true)], said);
    expect(blind.letters).toEqual([]);
    expect(blind.said).toEqual(said);
    expect(blind.held.map((mark) => mark.unread)).toEqual([["077-maestro-input-precondition"]]);
    // And the tick that reads the feed whole again is silent: this is the assert the defect
    // failed on — it is the SECOND letter about one pair that the field paid for.
    expect(tick(live, blind.said).letters).toEqual([]);
  });

  it("holds every mark when the tick read NOTHING at all", () => {
    const said = tick(live, []).said;
    const blind = tick([], said);
    expect(blind.said).toEqual(said);
    expect(blind.held).toHaveLength(1);
    expect(describeHeldNumberCollisions(blind.held)).toContain("077-web-catches-up");
    expect(describeHeldNumberCollisions(blind.held)).toContain("unread:");
  });

  it("still lifts the mark when BOTH halves were read and stopped qualifying", () => {
    // The disproof this lock accepts: the halves are in front of the tick and the criterion
    // rejects them. Nothing about this case changed, and that is the point of the pair of tests.
    const said = tick(live, []).said;
    const closed = tick(
      [half("077-maestro-input-precondition", false), half("077-web-catches-up", false)],
      said,
    );
    expect(closed.said).toEqual([]);
    expect(closed.held).toEqual([]);
  });

  it("drops a superseded key when every half of it was read", () => {
    // A third namesake appears: the two-half key is not live any more, and its halves ARE in
    // front of the tick — so it goes, and the three-half key is what stands.
    const said = tick(live, []).said;
    const grown = tick([...live, half("077-third", true)], said);
    expect(grown.letters).toHaveLength(1);
    expect(grown.said).toEqual([
      "number:077:077-maestro-input-precondition,077-third,077-web-catches-up",
    ]);
    expect(grown.held).toEqual([]);
  });

  it("drops a line that is not a key of this watchman at all", () => {
    // It names no halves, so no tick could ever disprove it — held for ever, it would be a
    // suppression nothing can lift. The direction of dropping it is a letter too many.
    const kept = tick(live, ["number:077", "pr:12", ""]).said;
    expect(kept).toEqual(["number:077:077-maestro-input-precondition,077-web-catches-up"]);
  });

  it("reads the halves back out of a key, and refuses what is not one", () => {
    expect(collisionKeyHalves("number:077:077-a,077-b")).toEqual(["077-a", "077-b"]);
    expect(collisionKeyHalves("number:077:")).toBeUndefined();
    expect(collisionKeyHalves("number:77:077-a,077-b")).toBeUndefined();
    expect(collisionKeyHalves("pr:12")).toBeUndefined();
  });
});
