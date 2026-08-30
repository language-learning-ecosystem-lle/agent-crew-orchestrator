import { describe, expect, it } from "vitest";

import { renderWake, type WakeFacts } from "./wake.js";

const facts = (over: Partial<WakeFacts> = {}): WakeFacts => ({
  role: { id: "dev-core", instructions: ["CLAUDE.md"] },
  cli: "agent-protocol",
  ref: "origin/main",
  mailRoot: "/srv/project/.worktrees/comms/agent-comms",
  mailBranch: "comms",
  threads: [],
  unreadable: [],
  ...over,
});

describe("renderWake", () => {
  it("называет роль, её карточку и оба факта почты из конфига", () => {
    const text = renderWake(facts());
    expect(text).toContain("Ты — роль dev-core");
    expect(text).toContain("CLAUDE.md");
    expect(text).toContain("`comms`");
    expect(text).toContain("/srv/project/.worktrees/comms/agent-comms");
  });

  it("ветка почты берётся из фактов, а не зашита константой", () => {
    const text = renderWake(facts({ mailBranch: "mail-branch" }));
    expect(text).toContain("`mail-branch`");
    expect(text).not.toContain("`comms`");
  });

  it("печатает треды в данном порядке и команду чтения — командой пакета, а не путём к файлу", () => {
    const text = renderWake(facts({ threads: ["087-wake-cut", "004-box-identity"] }));
    expect(text.indexOf("087-wake-cut")).toBeLessThan(text.indexOf("004-box-identity"));
    expect(text).toContain("thread show --thread <id> --for dev-core --ref origin/main");
    // Вход из ИСТОЧНИКА: производное имя не должно попасть в шаг чтения (тред 087 §2.3).
    expect(text).not.toContain("_thread.md` и остальные файлы");
  });

  it("без почты зовёт на вахту, а не сообщает об ошибке", () => {
    const text = renderWake(facts());
    expect(text).toContain("Почты для dev-core нет");
    expect(text).toContain("Вахта — штатный режим ожидания");
  });

  it("непрочитанное названо и не выдаётся за полный вход", () => {
    const text = renderWake(facts({ threads: ["001-a"], unreadable: ["066-x: нет `_meta.md`"] }));
    expect(text).toContain("Прочитано не всё");
    expect(text).toContain("066-x: нет `_meta.md`");
  });

  it("форма вызова CLI — параметр: чужой ящик зовёт пакет по-своему", () => {
    const text = renderWake(facts({ cli: "pnpm -w protocol", threads: ["001-a"] }));
    expect(text).toContain("pnpm -w protocol thread show");
    expect(text).toContain("pnpm -w protocol new-message");
    expect(text).not.toContain("agent-protocol thread show");
  });

  it("роль без карточки в конфиге — сказано прямо, а не молча пусто", () => {
    const text = renderWake(facts({ role: { id: "x", instructions: [] } }));
    expect(text).toContain("Карточка роли в конфиге не объявлена");
  });
});
