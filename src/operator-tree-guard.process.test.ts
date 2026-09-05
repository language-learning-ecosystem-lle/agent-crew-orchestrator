/**
 * ЗАБОР ОПЕРАТОРСКОЙ РУКИ ГОНЯЕТ СЮИТА, а не тот, кто вспомнил (тред 062, постановка
 * curator 2026-09-05). `scripts/operator-tree-guard.test.sh` прогоняет
 * `scripts/operator-tree-guard.sh` по фикстуре из своего и чужого дерева, а этот файл —
 * то, чем CI заставляют этот скрипт гонять.
 *
 * ПОЧЕМУ ПРОЦЕССОМ, А НЕ ПЕРЕПИСАН НА TS. Забор набирают рукой в ssh перед операторским
 * блоком — он поэтому bash, и вторая реализация на TS была бы утверждением О заборе, а не
 * самим забором. Стык здесь буквальный: судится тот файл, который поедет на ящик.
 *
 * ПОЧЕМУ НЕ ОСТАВЛЕН РУЧНЫМ, как `comms-push.test.sh`. Его читают в час аварии, когда
 * человек уже торопится, и цена молчаливой поломки — ровно полевой случай 2026-09-05:
 * блок из шести команд применился наполовину (`.npmrc` записан, `git commit` отказал
 * `dubious ownership`), и об этом никто не объявлял. Забор, отказавший безымянно или
 * пропустивший чужое дерево, от исправного в этот момент неотличим.
 *
 * Шага воркфлоу не стоит: `pnpm test` уже гоняет эту сюиту, а скрипту нужны только bash,
 * `stat`, `id` и временный каталог.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const GUARD_TEST = fileURLToPath(
  new URL("../../../scripts/operator-tree-guard.test.sh", import.meta.url),
);

describe("operator-tree-guard.sh", () => {
  it("держит свою фикстуру — чужое дерево отказывает по имени, своё пропускается", () => {
    let output: string;
    let failed: unknown;
    try {
      output = execFileSync("bash", [GUARD_TEST], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      // Диагноз — собственный отчёт скрипта: одно «exit code 1» это отказ, с которым
      // нечего делать.
      failed = error;
      output = String((error as { stdout?: string }).stdout ?? "");
    }
    expect(`${output}${failed === undefined ? "" : "\n(скрипт вернул ненулевой код)"}`).toContain(
      "ВСЕ ПРОВЕРКИ ПРОШЛИ",
    );
    expect(failed).toBeUndefined();
  });
});
