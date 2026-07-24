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

describe("метки и срок", () => {
  it("метка — UTC без миллисекунд", () => {
    expect(holdStamp(new Date("2026-07-24T14:00:00.512Z"))).toBe("2026-07-24T14:00:00Z");
  });

  it("срок считается вперёд от момента взятия", () => {
    expect(holdExpiry(NOW, 3600)).toBe("2026-07-24T15:00:00Z");
  });
});

describe("parseHold — громкий отказ вместо тихого «holdʼа нет»", () => {
  it("круглый рейс render → parse", () => {
    expect(parseHold(renderHold(hold({ note: "приёмка целого" })))).toEqual(
      hold({ note: "приёмка целого" }),
    );
  });

  it("не JSON — ошибка", () => {
    expect(() => parseHold("держу роль")).toThrow(/не JSON/);
  });

  it("метка не в UTC-формате — ошибка схемы", () => {
    expect(() => parseHold(JSON.stringify(hold({ expires: "2026-07-24 14:30" })))).toThrow();
  });

  it("без `by` не разбирается — hold без держателя нечитаем", () => {
    const { by: _dropped, ...rest } = hold();
    expect(() => parseHold(JSON.stringify(rest))).toThrow();
  });
});

describe("foldHolds — срок решает, а не наличие файла", () => {
  it("срок впереди → роль занята", () => {
    expect(foldHolds([hold()], NOW)[0]?.active).toBe(true);
  });

  it("срок истёк → hold не действует (мёртвая сессия контур не блокирует)", () => {
    expect(foldHolds([hold({ expires: "2026-07-24T13:59:59Z" })], NOW)[0]?.active).toBe(false);
  });

  it("граница включительна — ровно в момент истечения роль ещё занята", () => {
    expect(foldHolds([hold({ expires: "2026-07-24T14:00:00Z" })], NOW)[0]?.active).toBe(true);
  });

  it("heldRoles отдаёт только действующие", () => {
    const views = foldHolds(
      [hold(), hold({ role: "dev-speech", expires: "2026-07-24T13:00:00Z" })],
      NOW,
    );
    expect(heldRoles(views)).toEqual(["dev-core"]);
  });
});

describe("renderHolds", () => {
  it("пусто — честная строка, а не пустой вывод", () => {
    expect(renderHolds([])).toBe("оркестратор: ручных holdʼов нет");
  });

  it("действующий hold называет роль, держателя и срок", () => {
    const line = renderHolds(foldHolds([hold({ note: "приёмка" })], NOW));
    expect(line).toContain("dev-core");
    expect(line).toContain("держит john");
    expect(line).toContain("до 2026-07-24T14:30:00Z");
    expect(line).toContain("(приёмка)");
    expect(line).toContain("ЗАНЯТА");
  });

  it("просроченный hold помечен и говорит, что делать", () => {
    const line = renderHolds(foldHolds([hold({ expires: "2026-07-24T13:00:00Z" })], NOW));
    expect(line).toContain("ПРОСРОЧЕН");
    expect(line).toContain("снимите файл");
  });

  it("несколько holdʼов — по строке на каждый", () => {
    const out = renderHolds(foldHolds([hold(), hold({ role: "dev-speech" })], NOW));
    expect(out.split("\n")).toHaveLength(2);
  });
});
