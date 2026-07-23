import { describe, expect, it } from "vitest";

import { parseMessageFile } from "./message.js";
import { parseMetaFile } from "./thread.js";
import { messageTimestamp, planNewMessage, planNewThread, WriteRefusedError } from "./write.js";

describe("messageTimestamp", () => {
  it("даёт UTC-метку без миллисекунд", () => {
    expect(messageTimestamp(new Date("2026-07-24T10:30:00.123Z"))).toBe("2026-07-24T10:30:00Z");
  });
});

describe("planNewMessage", () => {
  const base = {
    from: "dev-core",
    date: "2026-07-24T10:30:00Z",
    expects: "answer" as const,
    text: "Текст сообщения.",
    threadHasMessages: true,
  };

  it("ОТКАЗЫВАЕТСЯ писать в тред без messages/ (legacy)", () => {
    // Тот самый гард: файловая запись в немигрированный тред обрезала бы его
    // историю до одного файла (msg-034/056).
    expect(() => planNewMessage({ ...base, threadHasMessages: false })).toThrow(WriteRefusedError);
    expect(() => planNewMessage({ ...base, threadHasMessages: false })).toThrow(/legacy-форме/);
  });

  it("создаёт файл с именем из метки времени и роли, без seq/msg", () => {
    const planned = planNewMessage(base);

    expect(planned.path).toBe("messages/2026-07-24T10-30-00Z-dev-core.md");
    const parsed = parseMessageFile(planned.content);
    expect(parsed.fields).toEqual({
      from: "dev-core",
      date: "2026-07-24T10:30:00Z",
      expects: "answer",
    });
    expect(parsed.text).toBe("Текст сообщения.");
  });

  it("кладёт waiting-on полем, когда он задан", () => {
    const parsed = parseMessageFile(planNewMessage({ ...base, waitingOn: ["curator"] }).content);

    expect(parsed.fields.waitingOn).toEqual(["curator"]);
  });

  it("отказывается на пустом теле", () => {
    expect(() => planNewMessage({ ...base, text: "   " })).toThrow(/пусто/);
  });
});

describe("planNewThread", () => {
  const base = {
    title: "015-new · тред",
    participants: ["curator", "dev-core"],
    from: "curator",
    date: "2026-07-24T10:30:00Z",
    expects: "answer" as const,
    text: "Первое сообщение.",
  };

  it("рождает тред СРАЗУ в файловой форме: _meta.md + первое сообщение", () => {
    const files = planNewThread(base);

    expect(files.map((f) => f.path)).toEqual([
      "_meta.md",
      "messages/2026-07-24T10-30-00Z-curator.md",
    ]);
    const meta = parseMetaFile(files[0]?.content ?? "");
    expect(meta).toEqual({
      title: "015-new · тред",
      participants: ["curator", "dev-core"],
      status: "open",
    });
    expect(parseMessageFile(files[1]?.content ?? "").text).toBe("Первое сообщение.");
  });

  it("новый тред файловый по построению — legacy больше не рождается", () => {
    // planNewThread не имеет ветки threadHasMessages=false: тред создаётся
    // только файловым, поэтому new-message в него никогда не упрётся.
    const files = planNewThread(base);
    expect(files.some((f) => f.path.startsWith("messages/"))).toBe(true);
  });
});
