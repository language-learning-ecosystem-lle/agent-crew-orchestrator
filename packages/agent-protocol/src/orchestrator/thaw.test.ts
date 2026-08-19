import { describe, expect, it } from "vitest";
import {
  apiFailureSignalOf,
  describeFreeze,
  failureClassOf,
  THAW_BACKOFF_MINUTES,
  thawAt,
  thawDelayMinutes,
} from "./thaw.js";

describe("apiFailureSignalOf", () => {
  it("recognises the line of the episode — a 529 from the vendor", () => {
    const signal = apiFailureSignalOf('API Error: 529 {"type":"overloaded_error"}');
    expect(signal?.evidence).toContain("529");
  });

  it("recognises the shapes a proxy in front of the vendor produces", () => {
    expect(apiFailureSignalOf("503 Service Unavailable")).toBeDefined();
    expect(apiFailureSignalOf("upstream said 502 Bad Gateway")).toBeDefined();
  });

  it("recognises a network that never reached the vendor", () => {
    expect(apiFailureSignalOf("Connection error: ECONNRESET")).toBeDefined();
    expect(apiFailureSignalOf("socket hang up")).toBeDefined();
  });

  it("reads the stream's own JSON shape, not only prose", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "API Error: 529 Overloaded" }] },
    });
    expect(apiFailureSignalOf(line)).toBeDefined();
  });

  // The narrowness is the point: every shape here buys a pair a second life.
  it("stays silent on the causes that belong to another module", () => {
    expect(apiFailureSignalOf("429 rate_limit_error: too many requests")).toBeUndefined();
    expect(apiFailureSignalOf("authentication_error: invalid_api_key")).toBeUndefined();
    expect(apiFailureSignalOf("400 invalid_request_error: bad tool schema")).toBeUndefined();
  });

  it("stays silent on an ordinary line and never throws", () => {
    expect(apiFailureSignalOf("")).toBeUndefined();
    expect(apiFailureSignalOf("{not json")).toBeUndefined();
    expect(apiFailureSignalOf("the session wrote a message into the mail")).toBeUndefined();
  });
});

describe("failureClassOf", () => {
  it("is external when the vendor failed before the session reached the work", () => {
    expect(failureClassOf({ apiFailure: true, steps: 0 })).toBe("external");
    expect(failureClassOf({ apiFailure: true, steps: 1 })).toBe("external");
  });

  // A session that worked for forty minutes and then hit one 5xx failed at its own work.
  it("is substantive once the run had got going, signal or no signal", () => {
    expect(failureClassOf({ apiFailure: true, steps: 2 })).toBe("substantive");
    expect(failureClassOf({ apiFailure: true, steps: 40 })).toBe("substantive");
  });

  it("is substantive without a signal", () => {
    expect(failureClassOf({ apiFailure: false, steps: 0 })).toBe("substantive");
  });

  // Absence is not zero: a journal older than R18 counts no steps, and silence must not
  // buy a thaw nobody measured.
  it("is substantive when the step count was never measured", () => {
    expect(failureClassOf({ apiFailure: true })).toBe("substantive");
  });
});

describe("thawDelayMinutes", () => {
  it("walks the schedule 15 → 60 → 240 and then stops", () => {
    expect(thawDelayMinutes(1)).toBe(15);
    expect(thawDelayMinutes(2)).toBe(60);
    expect(thawDelayMinutes(3)).toBe(240);
    expect(thawDelayMinutes(4)).toBeUndefined();
    expect(THAW_BACKOFF_MINUTES).toEqual([15, 60, 240]);
  });

  it("has nothing to say about a round before the first", () => {
    expect(thawDelayMinutes(0)).toBeUndefined();
    expect(thawDelayMinutes(-1)).toBeUndefined();
  });
});

describe("thawAt", () => {
  const since = "2026-08-18T12:00:00Z";

  it("gives the first external freeze fifteen minutes", () => {
    expect(thawAt({ failureClass: "external", attempt: 3, ceiling: 3, since })).toBe(
      "2026-08-18T12:15:00Z",
    );
  });

  // A thaw does not reset the counter: the next failure lands on attempt 4, which IS the
  // second round — the schedule is derived from the counter rather than stored beside it.
  it("walks the rounds by the attempt counter past the ceiling", () => {
    expect(thawAt({ failureClass: "external", attempt: 4, ceiling: 3, since })).toBe(
      "2026-08-18T13:00:00Z",
    );
    expect(thawAt({ failureClass: "external", attempt: 5, ceiling: 3, since })).toBe(
      "2026-08-18T16:00:00Z",
    );
  });

  it("stops thawing once the schedule is spent — the freeze becomes final", () => {
    expect(thawAt({ failureClass: "external", attempt: 6, ceiling: 3, since })).toBeNull();
  });

  // The load-bearing asymmetry: three substantive failures are a statement of work that
  // needs a human, and silence is the correct answer to it.
  it("never thaws a substantive freeze", () => {
    expect(thawAt({ failureClass: "substantive", attempt: 3, ceiling: 3, since })).toBeNull();
    expect(thawAt({ failureClass: "substantive", attempt: 9, ceiling: 3, since })).toBeNull();
  });
});

describe("describeFreeze", () => {
  it("tells the two readings of a missing thaw apart", () => {
    expect(describeFreeze({ failureClass: "external", thaw: "2026-08-18T12:15:00Z" })).toContain(
      "thaws at 2026-08-18T12:15:00Z",
    );
    expect(describeFreeze({ failureClass: "external", thaw: null })).toContain("backoff is spent");
    expect(describeFreeze({ failureClass: "substantive", thaw: null })).toContain("substantive");
  });

  // The exit named by the two TERMINAL branches has to be one that exists (curator's §1,
  // thread 013): a delivery of this pair is written by a run of this pair, and an exhausted
  // pair is refused before it runs — so "only a delivery lifts it" advised a closed door.
  it("names a reachable exit on both terminal branches, and never a delivery", () => {
    for (const line of [
      describeFreeze({ failureClass: "substantive", thaw: null }),
      describeFreeze({ failureClass: "external", thaw: null }),
    ]) {
      expect(line).toContain("--max-attempts");
      expect(line).not.toContain("delivery");
    }
    // The branch that DOES lift itself keeps saying so and names no hand.
    const thawing = describeFreeze({ failureClass: "external", thaw: "2026-08-18T12:15:00Z" });
    expect(thawing).not.toContain("--max-attempts");
  });
});
