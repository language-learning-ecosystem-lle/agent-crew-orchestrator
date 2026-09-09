import { describe, expect, it } from "vitest";
import { parseMessageFile, renderMessageFile } from "./message.js";
import {
  describeGroundGone,
  foldGroundNotes,
  groundsGone,
  judgeParkGround,
  parseParkGround,
} from "./park-ground.js";
import type { Parking } from "./thread.js";

const key = (role: string, thread: string): string => JSON.stringify([role, thread]);

/** The second form's question, in the shape the tick answers it: nobody has delivered anything. */
const noDeliveries = (): boolean => false;

/** The third form's question, in the shape the tick answers it: this mail has landed nothing. */
const nothingMerged: ReadonlySet<number> = new Set();

const park = (over: Partial<Parking> = {}): Parking => ({
  kind: "person",
  person: "john",
  since: "2026-09-07T09:00:00Z",
  question: "unfreeze the pair, please",
  asks: true,
  ...over,
});

describe("the value of a named ground", () => {
  it("reads the one form it knows, in both spellings of the pair", () => {
    expect(parseParkGround("frozen:dev-core×063-slug")).toEqual({
      kind: "frozen",
      role: "dev-core",
      thread: "063-slug",
      raw: "frozen:dev-core×063-slug",
    });
    // The ASCII spelling exists for the shell and canonicalises to the `×` every reader prints.
    expect(parseParkGround("frozen:dev-core*063-slug")?.raw).toBe("frozen:dev-core×063-slug");
  });

  it("reads the second form — the thread whose feed is asked for a delivery", () => {
    expect(parseParkGround("no-delivers-since:110-adoption")).toEqual({
      kind: "no-delivers-since",
      thread: "110-adoption",
      raw: "no-delivers-since:110-adoption",
    });
    // Not a pair and not a person: a bare name after the colon is all this form takes, and a
    // value that only LOOKS like it is still unreadable — the door names it rather than guessing.
    expect(parseParkGround("no-delivers-since:")).toBeUndefined();
    expect(parseParkGround("no-delivers:110-adoption")).toBeUndefined();
  });

  it("reads the third form — the pull request whose merge ends the ground", () => {
    expect(parseParkGround("until-pr-merged:74")).toEqual({
      kind: "until-pr-merged",
      pr: 74,
      raw: "until-pr-merged:74",
    });
    // A number and nothing else: `#74`, an empty tail, a zero and a padded number are not values
    // this form means, and a reader that guessed at them would key its notes by two spellings of
    // one PR. The door names them while the writer can still retype.
    expect(parseParkGround("until-pr-merged:")).toBeUndefined();
    expect(parseParkGround("until-pr-merged:#74")).toBeUndefined();
    expect(parseParkGround("until-pr-merged:0")).toBeUndefined();
    expect(parseParkGround("until-pr-merged:074")).toBeUndefined();
  });

  it("refuses a ground it cannot ask BY NAME, and says what a park without one does", () => {
    const verdict = judgeParkGround("john decides");
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // Discipline 4: the value is quoted back, ALL THREE known forms are named, and the legality of
    // parking with no ground at all is stated — a refusal nobody can act on is a defect.
    expect(verdict.reason).toContain("--park-ground 'john decides'");
    expect(verdict.reason).toContain("frozen:<role>×<thread>");
    expect(verdict.reason).toContain("no-delivers-since:<thread>");
    expect(verdict.reason).toContain("until-pr-merged:<n>");
    expect(verdict.reason).toContain("needs no ground at all");
  });
});

describe("the third form: a park answered by a button and not by a word", () => {
  const parked = park({ ground: "until-pr-merged:74" });
  const standing = [{ thread: "016-x", parking: parked }];

  it("is named once that pull request is merged — the answer john gave with his hand", () => {
    const gone = groundsGone(standing, {
      frozen: new Set(),
      key,
      deliveredSince: noDeliveries,
      merged: new Set([74]),
    });
    expect(gone.map((entry) => entry.ground.raw)).toEqual(["until-pr-merged:74"]);
    const line = describeGroundGone(gone[0] as (typeof gone)[number]);
    expect(line).toContain("PR #74 IS merged");
    expect(line).toContain("The park still stands");
    expect(line).toContain("lift it by hand");
  });

  it("is silent while it is not merged, and deaf to the merge of a different PR", () => {
    expect(
      groundsGone(standing, {
        frozen: new Set(),
        key,
        deliveredSince: noDeliveries,
        merged: nothingMerged,
      }),
    ).toEqual([]);
    // The case this form was priced on had a park on #74 in a circuit merging PRs every day: a
    // form that answered "some PR landed" would fire on every one of them and mean nothing.
    expect(
      groundsGone(standing, {
        frozen: new Set(),
        key,
        deliveredSince: noDeliveries,
        merged: new Set([73, 75]),
      }),
    ).toEqual([]);
  });

  it("speaks when the PR was ALREADY merged at the moment the park was declared", () => {
    // No window, unlike the second form, and on purpose: a merge that had already happened makes
    // the park false as it is written. That is the case the door cannot catch — the writer parks
    // in the same breath — and it is the one case this feature exists for (thread 155, case 3).
    const gone = groundsGone(
      [
        {
          thread: "016-x",
          parking: park({ ground: "until-pr-merged:74", since: "2026-09-09T00:00:00Z" }),
        },
      ],
      { frozen: new Set(), key, deliveredSince: noDeliveries, merged: new Set([74]) },
    );
    expect(gone).toHaveLength(1);
  });

  it("does not answer the other forms' questions with its own input", () => {
    const all = [
      { thread: "016-x", parking: parked },
      { thread: "063-slug", parking: park({ ground: "frozen:dev-core×063-slug" }) },
      { thread: "155-x", parking: park({ ground: "no-delivers-since:110-adoption" }) },
    ];
    const gone = groundsGone(all, {
      // Everything merged, nothing frozen, nothing delivered: only the third form may speak here,
      // and a `frozen:`/`no-delivers-since:` park reading the merge set would be a false sentence
      // about a park nobody touched.
      frozen: new Set([key("dev-core", "063-slug")]),
      key,
      deliveredSince: noDeliveries,
      merged: new Set([74, 63, 110, 155]),
    });
    expect(gone.map((entry) => entry.thread)).toEqual(["016-x"]);
  });
});

describe("the second form: a park that outlived the answer it was waiting for", () => {
  const parked = park({ ground: "no-delivers-since:110-adoption" });
  const standing = [{ thread: "155-x", parking: parked }];

  it("is named when a delivery landed in that thread AFTER the park was declared", () => {
    const gone = groundsGone(standing, {
      frozen: new Set(),
      key,
      deliveredSince: (thread, since) => thread === "110-adoption" && since === parked.since,
      merged: nothingMerged,
    });
    expect(gone.map((entry) => entry.ground.raw)).toEqual(["no-delivers-since:110-adoption"]);
    const line = describeGroundGone(gone[0] as (typeof gone)[number]);
    // The clause is the fact in the tense of NOW, so the hand that reads it can check it.
    expect(line).toContain("thread 110-adoption HAS a letter carrying 'delivers:' since then");
    expect(line).toContain("The park still stands");
    expect(line).toContain("lift it by hand");
  });

  it("is silent when that thread carries no delivery at all", () => {
    expect(
      groundsGone(standing, {
        frozen: new Set(),
        key,
        deliveredSince: noDeliveries,
        merged: nothingMerged,
      }),
    ).toEqual([]);
  });

  it("is silent about a thread this box does not have — that is the door's refusal, not a note", () => {
    // A misspelled slug can never fall away, which is why the DOOR refuses it while the writer is
    // standing there. Here, in an append-only feed nothing can repair, it is read as no ground.
    expect(
      groundsGone(standing, {
        frozen: new Set(),
        key,
        deliveredSince: () => undefined,
        merged: nothingMerged,
      }),
    ).toEqual([]);
  });

  it("judges the two forms apart: a frozen pair does not silence a delivery, and back", () => {
    const both = [
      { thread: "155-x", parking: parked },
      { thread: "063-slug", parking: park({ ground: "frozen:dev-core×063-slug" }) },
    ];
    const gone = groundsGone(both, {
      // The pair IS frozen (the first form stays silent) and the delivery HAS landed (the second
      // speaks). One input cannot answer the other's question, and this is the assert that says so.
      frozen: new Set([key("dev-core", "063-slug")]),
      key,
      deliveredSince: () => true,
      merged: nothingMerged,
    });
    expect(gone.map((entry) => entry.thread)).toEqual(["155-x"]);
  });
});

describe("a park whose ground has fallen away", () => {
  const standing = [
    { thread: "063-slug", parking: park({ ground: "frozen:dev-core×063-slug" }) },
    { thread: "110-other", parking: park({ ground: "frozen:dev-acme×110-other" }) },
  ];

  it("is named when the pair it waits on is not frozen, and is silent while it is", () => {
    const frozen = new Set([key("dev-acme", "110-other")]);
    const gone = groundsGone(standing, {
      frozen,
      key,
      deliveredSince: noDeliveries,
      merged: nothingMerged,
    });
    expect(gone.map((entry) => entry.thread)).toEqual(["063-slug"]);
    expect(
      groundsGone(standing, {
        frozen: new Set([key("dev-core", "063-slug"), key("dev-acme", "110-other")]),
        key,
        deliveredSince: noDeliveries,
        merged: nothingMerged,
      }),
    ).toEqual([]);
  });

  it("says nothing at all about a park that named no ground — today's behaviour, unchanged", () => {
    expect(
      groundsGone([{ thread: "155-x", parking: park() }], {
        frozen: new Set(),
        key,
        deliveredSince: noDeliveries,
        merged: nothingMerged,
      }),
    ).toEqual([]);
  });

  it("skips a ground this version cannot read instead of inventing a meaning for it", () => {
    // The door refuses these, so one in the feed is older than this code or hand-written; the
    // honest reading of it is "no ground was named", never "the ground is gone".
    const older = [{ thread: "155-x", parking: park({ ground: "until john answers" }) }];
    expect(
      groundsGone(older, {
        frozen: new Set(),
        key,
        deliveredSince: noDeliveries,
        merged: nothingMerged,
      }),
    ).toEqual([]);
  });

  it("is NOT a lift: the sentence says the park stands and that a hand ends it", () => {
    const [gone] = groundsGone(standing, {
      frozen: new Set(),
      key,
      deliveredSince: noDeliveries,
      merged: nothingMerged,
    });
    if (gone === undefined) throw new Error("expected a gone ground");
    const line = describeGroundGone(gone);
    expect(line).toContain("thread 063-slug");
    expect(line).toContain("frozen:dev-core×063-slug");
    expect(line).toContain("The park still stands");
    expect(line).toContain("lift it by hand");
  });
});

describe("once per transition, not once per tick", () => {
  const gone = groundsGone(
    [{ thread: "063-slug", parking: park({ ground: "frozen:a×063-slug" }) }],
    { frozen: new Set(), key, deliveredSince: noDeliveries, merged: nothingMerged },
  );

  it("says a gone ground once and holds its tongue on every tick after it", () => {
    const first = foldGroundNotes(new Set(), gone);
    expect(first.say).toHaveLength(1);
    const second = foldGroundNotes(first.seen, gone);
    expect(second.say).toEqual([]);
  });

  it("says it again when the ground comes back and falls away a second time", () => {
    // The freeze returns (nothing to say), and with it the memory of the sentence must go: the
    // second fall is a new transition and an operator has no other way of learning about it.
    const said = foldGroundNotes(new Set(), gone).seen;
    const whileFrozen = foldGroundNotes(said, []);
    expect(whileFrozen.seen.size).toBe(0);
    expect(foldGroundNotes(whileFrozen.seen, gone).say).toHaveLength(1);
  });

  it("keys the sentence to THIS park declaration, so a park put back is named again", () => {
    const later = groundsGone(
      [
        {
          thread: "063-slug",
          parking: park({ ground: "frozen:a×063-slug", since: "2026-09-07T12:00:00Z" }),
        },
      ],
      { frozen: new Set(), key, deliveredSince: noDeliveries, merged: nothingMerged },
    );
    const said = foldGroundNotes(new Set(), gone).seen;
    expect(foldGroundNotes(said, later).say).toHaveLength(1);
  });
});

describe("the field in the header", () => {
  const file = [
    "---",
    "from: dev-core",
    "date: 2026-09-07T09:00:00Z",
    "expects: answer",
    "waiting-on: curator",
    "parked-on: john",
    "park-ground: frozen:dev-core×063-slug",
    "---",
    "",
    "unfreeze the pair, please",
    "",
  ].join("\n");

  it("survives the round trip a park depends on — written, read back, carried on the park", () => {
    const parsed = parseMessageFile(file);
    expect(parsed.fields.parkGround).toBe("frozen:dev-core×063-slug");
    expect(parsed.warnings ?? []).toEqual([]);
    expect(renderMessageFile(parsed)).toContain("park-ground: frozen:dev-core×063-slug");
  });

  it("drops an unreadable ground with the reason named, and reads the message anyway", () => {
    // The tolerant half of the reader: an append-only feed cannot be repaired, so a bad value
    // costs the FIELD and never the message — the park itself keeps working exactly as before.
    const parsed = parseMessageFile(file.replace("frozen:dev-core×063-slug", "when john answers"));
    expect(parsed.fields.parkGround).toBeUndefined();
    expect(parsed.fields.parkedOn).toBe("john");
    expect((parsed.warnings ?? []).join(" ")).toContain("park-ground: when john answers");
  });
});
