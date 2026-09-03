/**
 * ТЕСТ НА СТЫК ступени 2 треда `074-parallelism-and-domains`: шаг CI против
 * исключительных ресурсов, поднятый как настоящий процесс над настоящим репозиторием.
 *
 * ЮНИТ ЗДЕСЬ НЕ ПРОВЕРИЛ БЫ НИЧЕГО ЦЕННОГО. Вердикт скрипта — пересечение трёх списков
 * имён; риск не в нём, а в том, ЧТО ЭТИ СПИСКИ ЗНАЧАТ: считается ли общий предок, что
 * такое «уехало в базе», и не окажется ли ответ пустым просто потому, что merge-base не
 * посчитался. Всё это живёт в git, поэтому и фикстура — git.
 *
 * Приёмка из постановки (msg-006 §4) переписана сюда дословно: «искусственный случай (PR
 * тронул конфиг, в `main` конфиг уехал, ветка не подтянута) → красный шаг с именем файла;
 * тот же PR после подтягивания → зелёный».
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../../../../scripts/exclusive-freshness.mjs", import.meta.url),
);

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

/** Запуск скрипта как процесса: код выхода и вывод — весь его договор с шагом CI. */
const run = (repo: string, base: string, head: string): { code: number; out: string } => {
  try {
    const out = execFileSync(
      process.execPath,
      [SCRIPT, "--repo", repo, "--base", base, "--head", head],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
};

const commit = (repo: string, path: string, body: string, message: string): void => {
  writeFileSync(join(repo, path), body);
  git(repo, "add", "-A");
  git(repo, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-m", message);
};

describe("exclusive-freshness (процесс над настоящим git)", () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "excl-"));
    git(repo, "init", "-q", "-b", "main");
    commit(repo, "agent-protocol.json", '{"v":1}\n', "base");
    commit(repo, "README.md", "read me\n", "base docs");
    // ветка ответвляется здесь — дальше `main` и ветка едут врозь
    git(repo, "branch", "feature");
  });

  it("PR тронул конфиг, в базе конфиг уехал, ветка не подтянула → отказ с ИМЕНЕМ файла", () => {
    git(repo, "checkout", "-q", "feature");
    commit(repo, "agent-protocol.json", '{"v":1,"role":"branch"}\n', "ветка правит конфиг");
    git(repo, "checkout", "-q", "main");
    commit(repo, "agent-protocol.json", '{"v":2}\n', "чужая правка конфига уехала в main");

    const { code, out } = run(repo, "main", "feature");
    expect(code).toBe(1);
    // отказ обязан называть, ЧТО чинить: имя файла и действие
    expect(out).toContain("agent-protocol.json");
    expect(out).toContain("::error::");
    expect(out).toMatch(/подтян/i);
  });

  it("тот же PR после подтягивания базы → чисто", () => {
    git(repo, "checkout", "-q", "feature");
    git(
      repo,
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "user.name=t",
      "merge",
      "-q",
      "--no-edit",
      "-X",
      "ours",
      "main",
    );
    git(repo, "checkout", "-q", "main");

    const { code, out } = run(repo, "main", "feature");
    expect(code).toBe(0);
    expect(out).toContain("чисто");
  });

  it("PR не трогает исключительных файлов → шаг молчит и зеленеет, даже если база уехала", () => {
    git(repo, "checkout", "-q", "main");
    git(repo, "checkout", "-q", "-b", "docs-only");
    commit(repo, "README.md", "read me twice\n", "только доки");
    git(repo, "checkout", "-q", "main");
    commit(repo, "agent-protocol.json", '{"v":3}\n', "конфиг уехал ещё раз");

    const { code, out } = run(repo, "main", "docs-only");
    expect(code).toBe(0);
    expect(out).toContain("не трогает");
  });

  it("общего предка нет (shallow/чужой ref) → отказ КОДОМ 2 и с причиной, а не тихий зелёный", () => {
    const { code, out } = run(repo, "no-such-ref", "main");
    expect(code).toBe(2);
    expect(out).toContain("no-such-ref");
    expect(out).toMatch(/fetch-depth/);
  });
});
