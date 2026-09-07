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

  it("refuses a ground it cannot ask BY NAME, and says what a park without one does", () => {
    const verdict = judgeParkGround("john decides");
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // Discipline 4: the value is quoted back, BOTH known forms are named, and the legality of
    // parking with no ground at all is stated — a refusal nobody can act on is a defect.
    expect(verdict.reason).toContain("--park-ground 'john decides'");
    expect(verdict.reason).toContain("frozen:<role>×<thread>");
    expect(verdict.reason).toContain("no-delivers-since:<thread>");
    expect(verdict.reason).toContain("needs no ground at all");
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
    });
    expect(gone.map((entry) => entry.ground.raw)).toEqual(["no-delivers-since:110-adoption"]);
    const line = describeGroundGone(gone[0] as (typeof gone)[number]);
    // The clause is the fact in the tense of NOW, so the hand that reads it can check it.
    expect(line).toContain("thread 110-adoption HAS a letter carrying 'delivers:' since then");
    expect(line).toContain("The park still stands");
    expect(line).toContain("lift it by hand");
  });

  it("is silent when that thread carries no delivery at all", () => {
    expect(groundsGone(standing, { frozen: new Set(), key, deliveredSince: noDeliveries })).toEqual(
      [],
    );
  });

  it("is silent about a thread this box does not have — that is the door's refusal, not a note", () => {
    // A misspelled slug can never fall away, which is why the DOOR refuses it while the writer is
    // standing there. Here, in an append-only feed nothing can repair, it is read as no ground.
    expect(
      groundsGone(standing, { frozen: new Set(), key, deliveredSince: () => undefined }),
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
    const gone = groundsGone(standing, { frozen, key, deliveredSince: noDeliveries });
    expect(gone.map((entry) => entry.thread)).toEqual(["063-slug"]);
    expect(
      groundsGone(standing, {
        frozen: new Set([key("dev-core", "063-slug"), key("dev-acme", "110-other")]),
        key,
        deliveredSince: noDeliveries,
      }),
    ).toEqual([]);
  });

  it("says nothing at all about a park that named no ground — today's behaviour, unchanged", () => {
    expect(
      groundsGone([{ thread: "155-x", parking: park() }], {
        frozen: new Set(),
        key,
        deliveredSince: noDeliveries,
      }),
    ).toEqual([]);
  });

  it("skips a ground this version cannot read instead of inventing a meaning for it", () => {
    // The door refuses these, so one in the feed is older than this code or hand-written; the
    // honest reading of it is "no ground was named", never "the ground is gone".
    const older = [{ thread: "155-x", parking: park({ ground: "until john answers" }) }];
    expect(groundsGone(older, { frozen: new Set(), key, deliveredSince: noDeliveries })).toEqual(
      [],
    );
  });

  it("is NOT a lift: the sentence says the park stands and that a hand ends it", () => {
    const [gone] = groundsGone(standing, { frozen: new Set(), key, deliveredSince: noDeliveries });
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
    { frozen: new Set(), key, deliveredSince: noDeliveries },
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
      { frozen: new Set(), key, deliveredSince: noDeliveries },
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
