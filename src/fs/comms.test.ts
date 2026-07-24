import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadThreads, renderThreadFailures } from "./comms.js";

const ROLES = ["dev-core", "curator", "john"];

const META = "---\ntitle: Тред\nparticipants: dev-core, curator\nstatus: open\n---\n";
const MESSAGE =
  "---\nfrom: curator\ndate: 2026-07-24T13:45:12Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nТело.\n";

/** Пустой корень почты во временном каталоге. */
const root = (): string => mkdtempSync(join(tmpdir(), "agent-protocol-comms-"));

/** Мигрированный тред: `_meta.md` + одно сообщение файлом. */
const migrated = (at: string, id: string): void => {
  mkdirSync(join(at, id, "messages"), { recursive: true });
  writeFileSync(join(at, id, "_meta.md"), META);
  writeFileSync(join(at, id, "messages", "2026-07-24T13-45-12Z-curator.md"), MESSAGE);
};

/** Legacy-тред: единый `_thread.md`, каталога сообщений нет. */
const legacy = (at: string, id: string): void => {
  mkdirSync(join(at, id), { recursive: true });
  writeFileSync(
    join(at, id, "_thread.md"),
    `# ${id} · Тред\n\nparticipants: dev-core, curator · status: open\n\n## msg-001 · from: curator · 2026-07-24 · expects: answer\n\nТело.\n\nwaiting-on → dev-core\n`,
  );
};

describe("loadThreads — сбой одного треда не ослепляет контур", () => {
  it("полу-мигрированный тред уходит в failures, остальные читаются", () => {
    const at = root();
    migrated(at, "012-ok");
    migrated(at, "013-ok");
    // Файл сообщения, положенный в legacy-тред руками: `messages/` есть,
    // `_meta.md` нет — ровно инцидент с 009.
    legacy(at, "009-broken");
    mkdirSync(join(at, "009-broken", "messages"));
    writeFileSync(join(at, "009-broken", "messages", "2026-07-24T21-00-00Z-curator.md"), MESSAGE);

    const { threads, failures } = loadThreads(at, ROLES);

    expect(threads.map((loaded) => loaded.thread.id)).toEqual(["012-ok", "013-ok"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.id).toBe("009-broken");

    rmSync(at, { recursive: true, force: true });
  });

  it("причина названа состоянием, а не путём файла", () => {
    const at = root();
    legacy(at, "009-broken");
    mkdirSync(join(at, "009-broken", "messages"));
    writeFileSync(join(at, "009-broken", "messages", "2026-07-24T21-00-00Z-curator.md"), MESSAGE);

    const { failures } = loadThreads(at, ROLES);

    expect(failures[0]?.problem).toContain("полу-мигрированный");
    expect(failures[0]?.problem).toContain("_meta.md");
    // Рядом legacy-`_thread.md` — подсказка, что с этим делать, обязана быть.
    expect(failures[0]?.problem).toContain("домигрируйте");

    rmSync(at, { recursive: true, force: true });
  });

  it("сломанный `_meta.md` тоже изолируется, а не роняет обход", () => {
    const at = root();
    migrated(at, "012-ok");
    migrated(at, "013-broken");
    writeFileSync(join(at, "013-broken", "_meta.md"), "мусор без заголовка\n");

    const { threads, failures } = loadThreads(at, ROLES);

    expect(threads.map((loaded) => loaded.thread.id)).toEqual(["012-ok"]);
    expect(failures.map((failure) => failure.id)).toEqual(["013-broken"]);

    rmSync(at, { recursive: true, force: true });
  });

  it("всё цело — failures пуст, треды по порядку id", () => {
    const at = root();
    migrated(at, "013-b");
    migrated(at, "012-a");
    legacy(at, "009-legacy");

    const { threads, failures } = loadThreads(at, ROLES);

    expect(failures).toEqual([]);
    expect(threads.map((loaded) => loaded.thread.id)).toEqual(["009-legacy", "012-a", "013-b"]);
    expect(threads.find((loaded) => loaded.thread.id === "009-legacy")?.legacy).toBe(true);

    rmSync(at, { recursive: true, force: true });
  });

  it("нечитаемый КОРЕНЬ — по-прежнему исключение: это не «часть почты», а её отсутствие", () => {
    expect(() =>
      loadThreads(join(tmpdir(), "agent-protocol-нет-такого-каталога"), ROLES),
    ).toThrow();
  });
});

describe("renderThreadFailures", () => {
  it("строка на сбой: id треда и что именно не так", () => {
    const lines = renderThreadFailures([{ id: "009-mobile-front", problem: "полу-мигрированный" }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("009-mobile-front");
    expect(lines[0]).toContain("не прочитан");
    expect(lines[0]).toContain("полу-мигрированный");
  });

  it("нет сбоев — нет строк (тишина здесь честна: жаловаться не на что)", () => {
    expect(renderThreadFailures([])).toEqual([]);
  });
});
