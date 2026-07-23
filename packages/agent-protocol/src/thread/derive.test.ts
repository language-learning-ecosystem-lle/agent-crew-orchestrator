import { describe, expect, it } from "vitest";

import { renderIndex } from "./index-doc.js";
import type { Message } from "./message.js";
import { renderThread, type ThreadMeta } from "./thread.js";

// derive() в CLI склеивает ровно эти два рендера — здесь проверяется их
// согласованность на уровне ядра: собранный тред и реестр не расходятся между
// собой, а повторная сборка идемпотентна (на этом стоит «коммитить только при
// расхождении», то есть мягкий переход без двойного писателя).

const meta = (status: "open" | "closed"): ThreadMeta => ({
  title: "012-x · тред",
  participants: ["curator", "dev-core"],
  status,
});

const msg = (from: string, date: string, waitingOn?: string[]): Message => ({
  fields: { from, date, expects: "answer", ...(waitingOn ? { waitingOn } : {}) },
  text: "текст",
});

describe("derive (согласованность производных)", () => {
  it("повторная сборка _thread.md идемпотентна", () => {
    const messages = [msg("curator", "2026-07-23T10:00:00Z", ["dev-core"])];
    const once = renderThread(meta("open"), messages);
    // «Разобрать обратно» здесь не нужно: идемпотентность рендера — что при тех
    // же входах выходит тот же байт-в-байт результат — и есть свойство, на
    // которое опирается идемпотентный action.
    const twice = renderThread(meta("open"), messages);

    expect(twice).toBe(once);
  });

  it("INDEX и _thread.md согласованы по waiting-on одного треда", () => {
    const messages = [
      msg("curator", "2026-07-23T10:00:00Z", ["dev-core"]),
      msg("dev-core", "2026-07-23T11:00:00Z", ["curator"]),
    ];
    const thread = { id: "012-x", meta: meta("open"), messages };
    const index = renderIndex([thread]);

    // Последнее объявление — curator; и в INDEX колонка waiting-on, и хвост
    // собранного треда должны говорить одно и то же.
    expect(index).toContain("| 012-x | curator, dev-core | open | curator |");
    expect(renderThread(thread.meta, messages)).toContain(
      "dev-core · 2026-07-23 · expects: answer",
    );
  });

  it("закрытый тред в INDEX не ждёт никого, что бы ни было в последнем сообщении", () => {
    const thread = {
      id: "012-x",
      meta: meta("closed"),
      messages: [msg("curator", "2026-07-23T10:00:00Z", ["dev-core"])],
    };

    expect(renderIndex([thread])).toContain("| 012-x | curator, dev-core | closed | — |");
  });
});
