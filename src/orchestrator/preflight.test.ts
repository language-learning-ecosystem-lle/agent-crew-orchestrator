import { describe, expect, it } from "vitest";

import {
  agentBinaryVerdict,
  type CheckoutFacts,
  environmentVerdict,
  mailCheckoutVerdict,
  type PreflightCheck,
  preflightPassed,
  renderPreflight,
} from "./preflight.js";

const facts = (over: Partial<CheckoutFacts> = {}): CheckoutFacts => ({
  branch: "comms",
  expectedBranch: "comms",
  dirty: false,
  behind: 0,
  ahead: 0,
  ...over,
});

describe("mailCheckoutVerdict", () => {
  it("свежий чекаут на нужной ветке → ok", () => {
    expect(mailCheckoutVerdict(facts()).status).toBe("ok");
  });

  it("отставание — ОТКАЗ: работа по вчерашней почте хуже отказа", () => {
    const verdict = mailCheckoutVerdict(facts({ behind: 3 }));
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("отстал");
    expect(verdict.detail).toContain("3");
  });

  it("грязное дерево — отказ, а НЕ автопочинка: роль может писать сообщение", () => {
    const verdict = mailCheckoutVerdict(facts({ dirty: true }));
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("не трогаю");
  });

  it("незапушенные коммиты — отказ: контур читал бы почту, которой нет у остальных", () => {
    expect(mailCheckoutVerdict(facts({ ahead: 2 })).status).toBe("fail");
  });

  it("чужая ветка — отказ с обоими именами, чтобы было видно расхождение", () => {
    const verdict = mailCheckoutVerdict(facts({ branch: "main" }));
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("main");
    expect(verdict.detail).toContain("comms");
  });

  it("ветка проверяется ПЕРВОЙ: на чужой ветке остальные факты не о том", () => {
    const verdict = mailCheckoutVerdict(facts({ branch: "main", dirty: true, behind: 5 }));
    expect(verdict.detail).toContain("живёт в");
  });
});

describe("agentBinaryVerdict", () => {
  it("бинарь найден → ok с путём", () => {
    expect(agentBinaryVerdict("claude", "/usr/bin/claude")).toEqual({
      name: "агент: бинарь",
      status: "ok",
      detail: "/usr/bin/claude",
    });
  });

  it("не найден → отказ, и сказано ПОЧЕМУ это важно до аренды", () => {
    const verdict = agentBinaryVerdict("claude", null);
    expect(verdict.status).toBe("fail");
    expect(verdict.detail).toContain("аренде");
  });
});

describe("environmentVerdict", () => {
  it("показывает версию node, которую унаследует ребёнок", () => {
    const verdict = environmentVerdict({ nodeVersion: "v24.18.0", appliedKeys: [] });
    expect(verdict.detail).toContain("v24.18.0");
    expect(verdict.detail).toContain("преамбулы окружения нет");
  });

  it("называет применённые ключи преамбулы", () => {
    const verdict = environmentVerdict({ nodeVersion: "v24.18.0", appliedKeys: ["PATH"] });
    expect(verdict.detail).toContain("преамбула: PATH");
  });

  it("проверка мягкая: пакет не знает, какая версия «правильная» для чужого проекта", () => {
    expect(environmentVerdict({ nodeVersion: null, appliedKeys: [] }).status).toBe("ok");
  });
});

describe("итог и витрина", () => {
  const ok: PreflightCheck = { name: "a", status: "ok", detail: "d" };
  const bad: PreflightCheck = { name: "b", status: "fail", detail: "почему" };

  it("один провал валит весь preflight", () => {
    expect(preflightPassed([ok, ok])).toBe(true);
    expect(preflightPassed([ok, bad])).toBe(false);
  });

  it("печатается ЦЕЛИКОМ: что проверено — само по себе ответ", () => {
    const rendered = renderPreflight([ok, bad]);
    expect(rendered.split("\n")).toHaveLength(2);
    expect(rendered).toContain("✓ a");
    expect(rendered).toContain("✗ b: почему");
  });
});
