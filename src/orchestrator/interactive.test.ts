import { describe, expect, it } from "vitest";

import {
  DEFAULT_WAIT_INPUT_SECONDS,
  describeWait,
  parseWaitMarker,
  renderWaitMarker,
  waitAuthorised,
} from "./interactive.js";

const MARKER = {
  thread: "016-protocol-roadmap",
  at: "2026-07-26T10:00:00Z",
  session: "e9cb8d17-652f",
};

describe("the wait declaration (R19)", () => {
  it("round-trips: what is written is what is read", () => {
    expect(parseWaitMarker(renderWaitMarker(MARKER))).toEqual(MARKER);
  });

  it("the session is optional — a run that never learned its own id can still park", () => {
    const marker = { thread: "t", at: "2026-07-26T10:00:00Z" };
    expect(parseWaitMarker(renderWaitMarker(marker))).toEqual(marker);
  });

  it("a marker that does not parse is NOT a wait", () => {
    // The direction every unknown in this mechanism falls in: the default has to be
    // the one that ENDS runs. A broken marker that parked a session would hold a lease
    // with nobody able to say why.
    expect(parseWaitMarker("not json at all")).toBeUndefined();
    expect(parseWaitMarker('{"thread":"t"}')).toBeUndefined();
    expect(parseWaitMarker('{"at":"2026-07-26T10:00:00Z"}')).toBeUndefined();
  });

  it("authorises the thread the run holds, and no other", () => {
    const ok = waitAuthorised({ raw: renderWaitMarker(MARKER), thread: MARKER.thread });
    expect(ok).toMatchObject({ ok: true, marker: MARKER });
  });

  it("a declaration for ANOTHER thread is refused with the reason, not ignored", () => {
    // A run is bound to one thread; a marker naming another one is a session that went
    // and wrote somewhere else. Refusing quietly would look like the flag did nothing.
    const verdict = waitAuthorised({ raw: renderWaitMarker(MARKER), thread: "009-mobile-front" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.why).toContain("016-protocol-roadmap");
      expect(verdict.why).toContain("009-mobile-front");
    }
  });

  it("no declaration at all is a refusal with its own sentence", () => {
    const verdict = waitAuthorised({ thread: "t" });
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.why).toContain("no wait was declared");
  });

  it("describeWait names the moment it began and the moment it expires", () => {
    const line = describeWait({ marker: MARKER, until: "2026-07-26T11:00:00Z" });
    expect(line).toContain("2026-07-26T10:00:00Z");
    expect(line).toContain("2026-07-26T11:00:00Z");
    expect(line).toContain("e9cb8d17-652f");
  });

  it("the default ceiling is an hour — above the answer latency this circuit has", () => {
    expect(DEFAULT_WAIT_INPUT_SECONDS).toBe(3600);
  });
});
