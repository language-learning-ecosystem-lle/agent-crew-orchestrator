import { describe, expect, it } from "vitest";

import { parseNotifyState, renderNotifyState } from "../notify/notify.js";
import {
  collisionRings,
  collisionSaidKey,
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
    const found = findNumberCollisions([
      half("048-box-privileges-today", false),
      half("048-session-privileges", false),
    ]);
    // The two halves of the field acceptance: the pair is found by the search, and it is
    // rejected by the criterion. A search that missed it would look identical in the plan.
    expect(found).toHaveLength(1);
    expect(found[0]?.halves).toHaveLength(2);
    expect(collisionRings(found[0] as never)).toBe(false);
    expect(planNumberCollisionWatch({ found, said: [] }).letters).toEqual([]);
    expect(describeQuietNumberCollisions(found)).toContain("048");
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
    const found = findNumberCollisions(live);
    const first = planNumberCollisionWatch({ found, said: [] });
    expect(first.letters).toHaveLength(1);
    const second = planNumberCollisionWatch({ found, said: first.said });
    expect(second.letters).toEqual([]);
    expect(second.said).toEqual(first.said);
    // And a third tick changes nothing either — silence is not a state of the feed.
    expect(planNumberCollisionWatch({ found, said: second.said }).letters).toEqual([]);
  });

  it("lifts the mark when the number is divorced — and rings again if it comes back", () => {
    const said = planNumberCollisionWatch({ found: findNumberCollisions(live), said: [] }).said;
    const divorced = planNumberCollisionWatch({
      found: findNumberCollisions([half("159-a", true), half("161-b", false)]),
      said,
    });
    expect(divorced.said).toEqual([]);
    expect(
      planNumberCollisionWatch({ found: findNumberCollisions(live), said: divorced.said }).letters,
    ).toHaveLength(1);
  });

  it("lifts the mark when every half closes — and rings again on a reopening", () => {
    const said = planNumberCollisionWatch({ found: findNumberCollisions(live), said: [] }).said;
    const quiet = planNumberCollisionWatch({
      found: findNumberCollisions([half("159-a", false), half("159-b", false)]),
      said,
    });
    expect(quiet.letters).toEqual([]);
    expect(quiet.said).toEqual([]);
    expect(
      planNumberCollisionWatch({ found: findNumberCollisions(live), said: quiet.said }).letters,
    ).toHaveLength(1);
  });

  it("rings again when a THIRD thread appears under a number already announced", () => {
    const said = planNumberCollisionWatch({ found: findNumberCollisions(live), said: [] }).said;
    const grown = planNumberCollisionWatch({
      found: findNumberCollisions([...live, half("159-c", true)]),
      said,
    });
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
      const found = findNumberCollisions(live);
      const first = planNumberCollisionWatch({ found, said: [] });
      expect(first.letters).toHaveLength(1);
      // The key comes back from the file byte for byte — the validator accepts what the
      // producer makes. This is the assert the two literals are bound by.
      expect(stateOf(first.said)).toEqual(first.said);
      expect(planNumberCollisionWatch({ found, said: stateOf(first.said) }).letters).toEqual([]);
    });

    it("a mark LIFTED through the file rings again when the pair comes back", () => {
      const said = stateOf(
        planNumberCollisionWatch({ found: findNumberCollisions(live), said: [] }).said,
      );
      // The number is divorced: the mark leaves the plan, and the file it is written into
      // then carries nothing at all.
      const divorced = planNumberCollisionWatch({
        found: findNumberCollisions([half("159-a", true), half("161-b", false)]),
        said,
      });
      expect(stateOf(divorced.said)).toEqual([]);
      expect(
        planNumberCollisionWatch({
          found: findNumberCollisions(live),
          said: stateOf(divorced.said),
        }).letters,
      ).toHaveLength(1);
    });

    it("a THREE-half key crosses the file too — the growth is not swallowed by the validator", () => {
      // The widest key this watchman makes: three ids joined by commas. A validator that
      // accepted only the two-half shape would drop it and say the same collision for ever.
      const grown = planNumberCollisionWatch({
        found: findNumberCollisions([...live, half("159-c", true)]),
        said: [],
      });
      expect(stateOf(grown.said)).toEqual(grown.said);
      expect(grown.said[0]).toBe("number:159:159-a,159-b,159-c");
    });
  });

  it("does NOT re-ring when one half of a live pair merely closes", () => {
    const said = planNumberCollisionWatch({ found: findNumberCollisions(live), said: [] }).said;
    // `159-a` stays open, `159-b` was closed already: the same pair, the same statement.
    const next = planNumberCollisionWatch({
      found: findNumberCollisions([half("159-a", true), half("159-b", false)]),
      said,
    });
    expect(next.letters).toEqual([]);
  });
});
