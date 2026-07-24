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
  it("пустая свёртка — честная строка, а не пустой вывод", () => {
    expect(renderStatus([])).toBe("оркестратор: сессий в журнале нет");
  });

  it("обычная строка несёт роль, тред, состояние, попытку и deadline", () => {
    const line = renderStatus([view({})]);
    expect(line).toContain("dev-core");
    expect(line).toContain("014-reviewer-verdict-delivery");
    expect(line).toContain("running");
    expect(line).toContain("попытка 1");
    expect(line).toContain("deadline 2026-07-24T13:30:00Z");
  });

  it("overdue выносится явной пометкой", () => {
    expect(renderStatus([view({ overdue: true })])).toContain("ПРОСРОЧЕНО");
  });

  it("exhausted выносится явной пометкой и отсылает к журналу", () => {
    const line = renderStatus([
      view({ state: "released", reason: "timeout", attempt: 3, exhausted: true }),
    ]);
    expect(line).toContain("ИСЧЕРПАНО");
    expect(line).toContain("журнал");
  });

  it("exhausted приоритетнее overdue в пометке", () => {
    // exhausted терминально (аренда снята), overdue тут не выставится вместе,
    // но пометка на всякий случай не двоится — исчерпание важнее.
    const line = renderStatus([view({ exhausted: true, overdue: true })]);
    expect(line).toContain("ИСЧЕРПАНО");
    expect(line).not.toContain("ПРОСРОЧЕНО");
  });

  it("deadline null печатается как прочерк", () => {
    expect(renderStatus([view({ deadline: null })])).toContain("deadline —");
  });

  it("несколько связок — по строке на каждую", () => {
    const out = renderStatus([view({ thread: "a" }), view({ thread: "b" })]);
    expect(out.split("\n")).toHaveLength(2);
  });
});
