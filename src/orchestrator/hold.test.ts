import { describe, expect, it } from "vitest";

import {
  foldHolds,
  type HoldRecord,
  heldRoles,
  holdExpiry,
  holdStamp,
  parseHold,
  renderHold,
  renderHolds,
} from "./hold.js";

const NOW = new Date("2026-07-24T14:00:00Z");

const hold = (partial: Partial<HoldRecord> = {}): HoldRecord => ({
  role: "dev-core",
  by: "john",
  taken: "2026-07-24T13:30:00Z",
  expires: "2026-07-24T14:30:00Z",
  ...partial,
});

describe("stamps and expiry", () => {
  it("the stamp is UTC without milliseconds", () => {
    expect(holdStamp(new Date("2026-07-24T14:00:00.512Z"))).toBe("2026-07-24T14:00:00Z");
  });

  it("expiry is counted forward from the moment the hold was taken", () => {
    expect(holdExpiry(NOW, 3600)).toBe("2026-07-24T15:00:00Z");
  });
});

describe("parseHold — a loud refusal instead of a quiet 'there is no hold'", () => {
  it("render → parse round-trip", () => {
    expect(parseHold(renderHold(hold({ note: "acceptance of the whole" })))).toEqual(
      hold({ note: "acceptance of the whole" }),
    );
  });

  it("not JSON — an error", () => {
    expect(() => parseHold("holding the role")).toThrow(/not JSON/);
  });

  it("a stamp not in UTC form — a schema error", () => {
    expect(() => parseHold(JSON.stringify(hold({ expires: "2026-07-24 14:30" })))).toThrow();
  });

  it("without `by` it does not parse — a hold with no holder is unreadable", () => {
    const { by: _dropped, ...rest } = hold();
    expect(() => parseHold(JSON.stringify(rest))).toThrow();
  });
});

describe("foldHolds — expiry decides, not the presence of a file", () => {
  it("expiry ahead → the role is taken", () => {
    expect(foldHolds([hold()], NOW)[0]?.active).toBe(true);
  });

  it("expired → the hold does not apply (a dead session does not block the circuit)", () => {
    expect(foldHolds([hold({ expires: "2026-07-24T13:59:59Z" })], NOW)[0]?.active).toBe(false);
  });

  it("the boundary is inclusive — exactly at the expiry moment the role is still taken", () => {
    expect(foldHolds([hold({ expires: "2026-07-24T14:00:00Z" })], NOW)[0]?.active).toBe(true);
  });

  it("heldRoles returns only the effective ones", () => {
    const views = foldHolds(
      [hold(), hold({ role: "dev-speech", expires: "2026-07-24T13:00:00Z" })],
      NOW,
    );
    expect(heldRoles(views)).toEqual(["dev-core"]);
  });
});

describe("renderHolds", () => {
  it("empty — an honest line, not empty output", () => {
    expect(renderHolds([])).toBe("orchestrator: no manual holds");
  });

  it("an effective hold names the role, the holder and the expiry", () => {
    const line = renderHolds(foldHolds([hold({ note: "acceptance" })], NOW));
    expect(line).toContain("dev-core");
    expect(line).toContain("held by john");
    expect(line).toContain("until 2026-07-24T14:30:00Z");
    expect(line).toContain("(acceptance)");
    expect(line).toContain("TAKEN");
  });

  it("an expired hold is marked and says what to do", () => {
    const line = renderHolds(foldHolds([hold({ expires: "2026-07-24T13:00:00Z" })], NOW));
    expect(line).toContain("EXPIRED");
    expect(line).toContain("remove the file");
  });

  it("several holds — one line each", () => {
    const out = renderHolds(foldHolds([hold(), hold({ role: "dev-speech" })], NOW));
    expect(out.split("\n")).toHaveLength(2);
  });
});
