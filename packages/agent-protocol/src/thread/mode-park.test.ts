/**
 * A MODE PARK IS NOT A QUESTION (thread 063, §2.3 of the second statement of work).
 *
 * Both shapes are legal and both freeze the pair; the difference is whether anybody was ASKED
 * for anything, and until `modeParks` the frame said the same sentence about the two. The
 * fixtures below differ in exactly ONE field — `expects` of the message that declared the park
 * — which is the whole point: a distinction that needs two different feeds to show up is a
 * distinction the reader cannot check.
 */
import { describe, expect, it } from "vitest";
import { modeParks, parkedThreads } from "./index-doc.js";
import type { Message } from "./message.js";
import type { Thread } from "./thread.js";

const message = (fields: Partial<Message["fields"]>, text = "Тело письма."): Message => ({
  fields: {
    from: "curator",
    date: "2026-09-02T10:00:00Z",
    expects: "answer",
    ...fields,
  } as Message["fields"],
  text,
});

const thread = (messages: readonly Message[], id = "063-state-model-rewrite"): Thread => ({
  id,
  meta: {
    title: "Модель состояний пары",
    participants: ["curator", "dev-core", "john"],
    status: "open",
  },
  messages,
});

describe("modeParks — the parks that ask nobody (thread 063)", () => {
  const question = thread([message({ parkedOn: "john", expects: "answer" })]);
  const mode = thread([message({ parkedOn: "john", expects: "none" })]);

  it("both shapes freeze the thread — the map the tick plans by does not change", () => {
    // The set is a SECOND fact beside the map, not a replacement for it: a mode park is a park.
    expect(parkedThreads([question])).toEqual(new Map([["063-state-model-rewrite", "john"]]));
    expect(parkedThreads([mode])).toEqual(new Map([["063-state-model-rewrite", "john"]]));
  });

  it("only the one declared with 'expects: none' is a mode", () => {
    expect(modeParks([question])).toEqual(new Set());
    expect(modeParks([mode])).toEqual(new Set(["063-state-model-rewrite"]));
  });

  // `ack` is an action required of the human just the same (the decision of 2026-08-03 that
  // `Parking.asks` carries): a park that waits to be acknowledged is a queue to a person, and
  // calling it a mode would silence the very call the courier exists to make.
  it("a park expecting an ACK is a question, not a mode", () => {
    expect(modeParks([thread([message({ parkedOn: "john", expects: "ack" })])])).toEqual(new Set());
  });

  // An event park calls nobody by construction, so "asks nobody" is true of every one of them
  // and says nothing. A frame that read one as a mode would invent a person to name.
  it("an event park is never a mode, whatever its 'expects' says", () => {
    const onRun = thread([message({ parkedOn: "run:187", expects: "none" })]);
    const onMerge = thread([message({ parkedOn: "pr:187", expects: "none" })]);

    expect(modeParks([onRun])).toEqual(new Set());
    expect(modeParks([onMerge])).toEqual(new Set());
  });

  // The same walk `parkingOf` does, and no second reading of the feed: a park that has been
  // LIFTED is not a mode any more — it is not a park at all.
  it("says nothing about a park the word of that person has already lifted", () => {
    const lifted = thread([
      message({ parkedOn: "john", expects: "none" }),
      message({ from: "curator", date: "2026-09-02T11:31:00Z", delivers: "john" }),
    ]);

    expect(parkedThreads([lifted])).toEqual(new Map());
    expect(modeParks([lifted])).toEqual(new Set());
  });

  it("a closed thread declares nothing — the acceptance is the answer", () => {
    const closed: Thread = {
      ...mode,
      meta: { ...mode.meta, status: "closed" },
    };

    expect(modeParks([closed])).toEqual(new Set());
  });
});
