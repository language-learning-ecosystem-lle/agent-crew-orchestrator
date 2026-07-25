import { describe, expect, it } from "vitest";

import type { LeaseView } from "./lease.js";
import { renderStatus } from "./status.js";

const view = (partial: Partial<LeaseView>): LeaseView => ({
  role: "dev-core",
  thread: "014-reviewer-verdict-delivery",
  state: "running",
  attempt: 1,
  deadline: "2026-07-24T13:30:00Z",
  reason: null,
  lastEvent: "lease-acquired",
  overdue: false,
  exhausted: false,
  launchable: false,
  ...partial,
});

describe("renderStatus", () => {
  it("an empty fold gives an honest line, not empty output", () => {
    expect(renderStatus([])).toBe("orchestrator: no sessions in the journal");
  });

  it("a normal line carries the role, thread, state, attempt and deadline", () => {
    const line = renderStatus([view({})]);
    expect(line).toContain("dev-core");
    expect(line).toContain("014-reviewer-verdict-delivery");
    expect(line).toContain("running");
    expect(line).toContain("attempt 1");
    expect(line).toContain("deadline 2026-07-24T13:30:00Z");
  });

  it("overdue is called out as an explicit mark", () => {
    expect(renderStatus([view({ overdue: true })])).toContain("OVERDUE");
  });

  it("exhausted is called out as an explicit mark and points at the journal", () => {
    const line = renderStatus([
      view({ state: "released", reason: "timeout", attempt: 3, exhausted: true }),
    ]);
    expect(line).toContain("EXHAUSTED");
    expect(line).toContain("journal");
  });

  it("exhausted takes priority over overdue in the mark", () => {
    // exhausted is terminal (the lease is released), overdue will not be set
    // alongside it here, but the mark must not double up anyway — exhaustion wins.
    const line = renderStatus([view({ exhausted: true, overdue: true })]);
    expect(line).toContain("EXHAUSTED");
    expect(line).not.toContain("OVERDUE");
  });

  it("a null deadline is printed as a dash", () => {
    expect(renderStatus([view({ deadline: null })])).toContain("deadline —");
  });

  it("several pairs — one line each", () => {
    const out = renderStatus([view({ thread: "a" }), view({ thread: "b" })]);
    expect(out.split("\n")).toHaveLength(2);
  });
});
