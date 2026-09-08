/**
 * THE `raised:` STAMP NO LONGER CHANGES ONE ANSWER OF THE PARK READER — and this file is what
 * says so, because until 2026-09-08 it was the whole of a norm.
 *
 * WHAT IT MEASURED, kept because the measurement is not withdrawn (thread 081, decision of john
 * 2026-09-02; the norm it wrote — `PROTOCOL.md`, «ОСНОВАНИЕ — ПОЛЕ ПРОВЕНАНСА В ШАПКЕ ПИСЬМА»).
 * Measured at a consumer on 2026-08-30 (thread `058-concurrent-writers-one-thread`): the circuit
 * raised the role at 14:24:19Z, curator parked the thread at 14:24:50Z, and the role's letter —
 * composed by a run that started 31 seconds before the park existed — landed at 14:26:53Z. The
 * park left the courier's composition, the human was shown a last line with no park in it, and
 * the standing question was never asked. 31 seconds too late to have been an answer to anything,
 * and it lifted the park all the same.
 *
 * WHY IT IS INERT NOW. The stamp narrowed ONE lift — the end of the TURN the park was declared
 * on (042, lifts (i) and (ii)) — by asking whether the writer's session could have SEEN the park.
 * Variant «А» of thread 155 (decision of john 2026-09-08) took that lift out whole: a park belongs
 * to the THREAD and is ended only by a letter that NAMES it (`park-lifted:`), by the event park's
 * own address, or by the thread being closed. With no lift to narrow, there is nothing left for
 * the provenance to filter — so the answer below is the same at every moment of raising, which is
 * exactly what these cases now assert.
 *
 * The field itself is untouched: it is still written, still parsed, and still read by everything
 * outside the park walk. What this file guards is that it says nothing about a PARK.
 */
import { describe, expect, it } from "vitest";
import type { Message } from "./message.js";
import { parkedOnOf, parkingOf, type Thread } from "./thread.js";

/** The three moments of the incident, named once so the fixtures read as the timeline. */
const RAISED = "2026-08-30T14:24:19Z";
const PARKED_AT = "2026-08-30T14:24:50Z";
const WROTE_AT = "2026-08-30T14:26:53Z";
/** A session raised AFTER the park — the case that used to answer differently from `RAISED`. */
const RAISED_LATER = "2026-08-30T14:25:30Z";

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
 * The letter that walks past it — a role handing the turn to somebody ELSE, which was exactly
 * lift (i) of the norm of 042. `raised:` is what the cases below vary, and it no longer matters.
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
  it("the incident, to the second: raised BEFORE the park — the park STANDS, as it did", () => {
    const at = parkedOnOf(thread([parkOnJohn, answerFrom(RAISED)]));
    expect(at).toBe("john");
    const parking = parkingOf(thread([parkOnJohn, answerFrom(RAISED)]));
    expect(parking?.kind).toBe("person");
    expect(parking?.since).toBe(PARKED_AT);
    expect(parking?.holder).toBe("dev-core");
  });

  it("raised AFTER the park — it STANDS TOO SINCE 2026-09-08: the lift it narrowed is gone", () => {
    // This lifted until variant «А», on the reading that the session had read the park in its own
    // feed, so its letter WAS an answer to it. It was an answer to the turn; the park is not a
    // turn any more.
    expect(parkedOnOf(thread([parkOnJohn, answerFrom(RAISED_LATER)]))).toBe("john");
  });

  it("raised at the SAME second as the park — stands: there is no doubt left to settle", () => {
    // The norm of 081 chose a direction for the ambiguous second and named its price: one empty
    // raise, against a thread frozen with its own answer inside. Neither side of that trade
    // exists now — the letter lifts nothing whenever it was composed.
    expect(parkedOnOf(thread([parkOnJohn, answerFrom(PARKED_AT)]))).toBe("john");
  });

  it("no `raised:` at all — stands, which is the whole existing feed", () => {
    expect(parkedOnOf(thread([parkOnJohn, answerFrom()]))).toBe("john");
  });

  it("THE STAMP IS INERT — three moments of raising, one answer, said as a comparison", () => {
    // The claim of this file after 155 is "nothing here depends on the field", and a claim about
    // sameness is tested by comparing rather than by three constants that happen to match.
    const answers = [RAISED, RAISED_LATER, PARKED_AT, undefined].map((raised) =>
      parkedOnOf(thread([parkOnJohn, answerFrom(raised)])),
    );
    expect(new Set(answers).size).toBe(1);
  });

  it("lift (ii) — the outcome at the SAME holder — went out with lift (i), at any stamp", () => {
    // The turn never changes hands here: the park is declared on dev-core's turn and the later
    // message hands the turn back to dev-core without asking anything (`expects: none`), which
    // was the actionable outcome of 042. Both stamps now answer the same.
    const outcome = message({
      from: "github",
      date: WROTE_AT,
      expects: "none",
      waitingOn: "dev-core",
      raised: RAISED,
    });
    expect(parkedOnOf(thread([parkOnJohn, outcome]))).toBe("john");
    const seen = { ...outcome, fields: { ...outcome.fields, raised: RAISED_LATER } };
    expect(parkedOnOf(thread([parkOnJohn, seen]))).toBe("john");
  });

  describe("what ends the park now — at ANY moment of raising", () => {
    it("`park-lifted: <the same park>` ends it from a session raised before it", () => {
      // The one lift a letter has. It is not a claim about having read the thread either — it is
      // a statement ABOUT the park, which a writer who had not read it could not make.
      const named = message({
        from: "curator",
        date: WROTE_AT,
        expects: "answer",
        waitingOn: "dev-core",
        parkLifted: "john",
        raised: RAISED,
      });
      expect(parkedOnOf(thread([parkOnJohn, named]))).toBeUndefined();
    });

    it("`delivers: <the person>` does NOT end it, at any moment of raising (155)", () => {
      // The word of the person themselves arriving. Until 2026-09-08 this lifted the park and the
      // provenance filter deliberately left it alone; under variant «А» it lifts nothing, so the
      // filter has nothing to leave alone here either.
      const courier = message({
        from: "curator",
        date: WROTE_AT,
        expects: "answer",
        waitingOn: "dev-core",
        delivers: "john",
        raised: RAISED,
      });
      expect(parkedOnOf(thread([parkOnJohn, courier]))).toBe("john");
      const later = { ...courier, fields: { ...courier.fields, raised: RAISED_LATER } };
      expect(parkedOnOf(thread([parkOnJohn, later]))).toBe("john");
    });

    it("`status: closed` outranks the park at any moment of raising", () => {
      expect(parkedOnOf(thread([parkOnJohn, answerFrom(RAISED)], "closed"))).toBeUndefined();
    });

    it("an event park does not move from the field by one line — nor by traffic (155)", () => {
      // `pr:`/`run:` wait for a machine event: nobody's decision stands behind them, so there was
      // never anything for "did the writer see the park" to be about. What changed on 2026-09-08
      // is the OTHER half — the wide walk that let any moving letter lift them went out too, and
      // what remains is each park's own address.
      const parkOnPr = message({
        from: "dev-core",
        date: PARKED_AT,
        expects: "none",
        waitingOn: "curator",
        parkedOn: "pr:204",
      });
      expect(parkedOnOf(thread([parkOnPr, answerFrom(RAISED)]))).toBe("pr:204");
      const runPark = { ...parkOnPr, fields: { ...parkOnPr.fields, parkedOn: "run:204" } };
      expect(parkedOnOf(thread([runPark, answerFrom(RAISED)]))).toBe("run:204");
      // And the run park's own address ends it, whatever the stamp of the verdict's session.
      const verdict = message({
        from: "reviewer-pr",
        date: WROTE_AT,
        expects: "answer",
        waitingOn: "dev-core",
        verdict: "approve",
        pr: 204,
        raised: RAISED,
      });
      expect(parkedOnOf(thread([runPark, verdict]))).toBeUndefined();
    });

    it("a park naming no holder keeps its power over the whole thread, as it did", () => {
      // The pre-042 park (016, 052): the feed does not say whose turn it was declared on. It was
      // outside both lifts then and it is outside the one lift now.
      const modePark = message({
        from: "curator",
        date: PARKED_AT,
        expects: "none",
        parkedOn: "john",
      });
      expect(parkedOnOf(thread([modePark, answerFrom(RAISED_LATER)]))).toBe("john");
    });
  });
});
