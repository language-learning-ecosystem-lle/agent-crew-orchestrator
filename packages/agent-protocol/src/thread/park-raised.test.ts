/**
 * A LETTER FROM A SESSION RAISED BEFORE THE PARK IS NOT AN ANSWER TO IT (thread 081, decision
 * of john 2026-09-02; norm — `PROTOCOL.md`, «ОСНОВАНИЕ — ПОЛЕ ПРОВЕНАНСА В ШАПКЕ ПИСЬМА»).
 *
 * The fixtures are the INCIDENT, to the second, and they differ from each other in exactly one
 * field — `raised:` of the letter that walks past the park. That is the whole subject: a
 * distinction that needs two different feeds to show up is one no reader can check.
 *
 * Measured at a consumer on 2026-08-30 (thread `058-concurrent-writers-one-thread`): the circuit
 * raised the role at 14:24:19Z, curator parked the thread at 14:24:50Z, and the role's letter —
 * composed by a run that started 31 seconds before the park existed — landed at 14:26:53Z. The
 * park left the courier's composition, the human was shown a last line with no park in it, and
 * the standing question was never asked.
 */
import { describe, expect, it } from "vitest";
import type { Message } from "./message.js";
import { parkedOnOf, parkingOf, type Thread } from "./thread.js";

/** The three moments of the incident, named once so the fixtures read as the timeline. */
const RAISED = "2026-08-30T14:24:19Z";
const PARKED_AT = "2026-08-30T14:24:50Z";
const WROTE_AT = "2026-08-30T14:26:53Z";

const message = (fields: Partial<Message["fields"]>): Message => ({
  fields: {
    from: "curator",
    date: PARKED_AT,
    expects: "answer",
    ...fields,
  } as Message["fields"],
  text: "Тело письма.",
});

const thread = (
  messages: readonly Message[],
  status: Thread["meta"]["status"] = "open",
): Thread => ({
  id: "081-park-lift-raised-field",
  meta: { title: "Момент подъёма сессии", participants: ["curator", "dev-core", "john"], status },
  messages,
});

/** The park itself: curator freezes the turn — dev-core's — behind a decision of john. */
const parkOnJohn = message({
  from: "curator",
  date: PARKED_AT,
  expects: "answer",
  waitingOn: "dev-core",
  parkedOn: "john",
});

/**
 * The letter that walks past it — a role handing the turn to somebody ELSE, which is exactly
 * lift (i) of the norm of 042. `raised:` is what the cases below vary.
 */
const answerFrom = (raised?: string): Message =>
  message({
    from: "dev-core",
    date: WROTE_AT,
    expects: "answer",
    waitingOn: "curator",
    ...(raised === undefined ? {} : { raised }),
  });

describe("the park on a person and the moment its answerer was raised (thread 081)", () => {
  it("the incident, to the second: raised BEFORE the park — the park STANDS", () => {
    const at = parkedOnOf(thread([parkOnJohn, answerFrom(RAISED)]));
    expect(at).toBe("john");
    const parking = parkingOf(thread([parkOnJohn, answerFrom(RAISED)]));
    expect(parking?.kind).toBe("person");
    expect(parking?.since).toBe(PARKED_AT);
    expect(parking?.holder).toBe("dev-core");
  });

  it("raised AFTER the park — it lifts, exactly as before the field existed", () => {
    // The session read the park in its own feed, so its letter IS an answer to it.
    expect(parkedOnOf(thread([parkOnJohn, answerFrom("2026-08-30T14:25:30Z")]))).toBeUndefined();
  });

  it("raised at the SAME second as the park — it lifts: doubt is settled towards lifting", () => {
    // The norm chose the direction and named the price: one empty raise, against a thread
    // frozen with its own answer inside.
    expect(parkedOnOf(thread([parkOnJohn, answerFrom(PARKED_AT)]))).toBeUndefined();
  });

  it("no `raised:` at all — it lifts, which is the whole existing feed", () => {
    expect(parkedOnOf(thread([parkOnJohn, answerFrom()]))).toBeUndefined();
  });

  it("lift (ii) — the outcome at the SAME holder — is filtered by the same stamp", () => {
    // The turn never changes hands here: the park is declared on dev-core's turn and the later
    // message hands the turn back to dev-core without asking anything (`expects: none`), which
    // is the actionable outcome of 042. Raised before the park, it opens no turn either.
    const outcome = message({
      from: "github",
      date: WROTE_AT,
      expects: "none",
      waitingOn: "dev-core",
      raised: RAISED,
    });
    expect(parkedOnOf(thread([parkOnJohn, outcome]))).toBe("john");
    const seen = { ...outcome, fields: { ...outcome.fields, raised: "2026-08-30T14:25:30Z" } };
    expect(parkedOnOf(thread([parkOnJohn, seen]))).toBeUndefined();
  });

  describe("the lifts the norm leaves alone — at ANY moment of raising", () => {
    it("`delivers: <the person>` lifts the park even from a session raised before it", () => {
      // The word of the person themselves. It is not a claim about having read the thread —
      // the human said it — so the filter does not touch it.
      const courier = message({
        from: "curator",
        date: WROTE_AT,
        expects: "answer",
        waitingOn: "dev-core",
        delivers: "john",
        raised: RAISED,
      });
      expect(parkedOnOf(thread([parkOnJohn, courier]))).toBeUndefined();
    });

    it("`status: closed` outranks the park at any moment of raising", () => {
      expect(parkedOnOf(thread([parkOnJohn, answerFrom(RAISED)], "closed"))).toBeUndefined();
    });

    it("an event park does not move from the field by one line", () => {
      // `pr:`/`run:` wait for a machine event: nobody's decision stands behind them, so there is
      // nothing for "did the writer see the park" to be about. The wide walk is untouched.
      const parkOnPr = message({
        from: "dev-core",
        date: PARKED_AT,
        expects: "none",
        waitingOn: "curator",
        parkedOn: "pr:204",
      });
      expect(parkedOnOf(thread([parkOnPr, answerFrom(RAISED)]))).toBeUndefined();
      const runPark = { ...parkOnPr, fields: { ...parkOnPr.fields, parkedOn: "run:204" } };
      expect(parkedOnOf(thread([runPark, answerFrom(RAISED)]))).toBeUndefined();
    });

    it("a park naming no holder keeps its power over the whole thread, as it did", () => {
      // The pre-042 park (016, 052): the feed does not say whose turn it was declared on, so
      // neither (i) nor (ii) applies and there is nothing for the stamp to filter.
      const modePark = message({
        from: "curator",
        date: PARKED_AT,
        expects: "none",
        parkedOn: "john",
      });
      expect(parkedOnOf(thread([modePark, answerFrom("2026-08-30T14:25:30Z")]))).toBe("john");
    });
  });
});
