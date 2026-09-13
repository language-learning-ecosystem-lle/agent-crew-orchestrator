---
name: gitless-tree-copy-reddens-four-tests
description: "Копия дерева краснит тесты, спрашивающие git про свой чекаут — число НЕ константа, его задаёт МЕСТО копии"
metadata: 
  node_type: memory
  type: project
  originSessionId: bc1d9e6f-2faf-48e7-8261-7a8b862c18e8
  modified: 2026-09-13T10:19:56.812Z
---

Приёмка на СКЛЕЕННОМ дереве (`git archive <tree> | tar -x`) краснит тесты, спрашивающие git про чекаут,
в котором они бегут. **Число красных — не константа, и задаёт его МЕСТО копии, а не дифф:**

- копия в `mktemp -d -p /tmp` (вне любого чекаута) — 4 красных + 1 ошибка сбора, все с одной причиной
  `fatal: not a git repository`. Замерено 2026-09-09 на `8762229…` (PR #360): `runtime-ignored.test.ts` (2),
  `force-stop-delivery.process.test.ts` (2), `build-artifacts-ignored.test.ts` (сбор). Итог `4053 passed | 4 failed`;
- копия в `mktemp -d` без `-p` — это **внутри чекаута** ([[bare-mktemp-lands-inside-the-checkout]]):
  `git rev-parse --show-toplevel` оттуда отвечает ГЛАВНЫМ чекаутом, тесты про git проходят, и краснеет
  один — `build-artifacts-ignored.test.ts > finds every tracked tsconfig`. Замерено 2026-09-13 (PR #371):
  `4183 passed | 1 failed (4184)`.

**Why:** эти тесты спрашивают git про своё дерево (`check-ignore`, `ls-files`, `rev-parse --show-toplevel`,
пуш следа в `origin/comms`), и ответ зависит от того, лежит копия под `.git` или нет. Гонять сюиту в рабочем
дереве роли вместо копии НЕЛЬЗЯ — [[suite-in-a-worktree-breaks-the-contour]], — так что краснота
неустранима и её встретит каждый, кто закрывает ноту сдвига базы по [[base-move-note-answered-by-measure]].

**How to apply:** число красных не переносить из этой заметки и не подавать красноту ни дефектом, ни
«неважным» — исключить СВОЮ руку контролем ([[reproduce-with-the-tool-that-measured]],
[[own-hand-crutches-hide-the-defect]]): тот же прогон на копии ЧИСТОГО `origin/main`, сделанной ТЕМ ЖЕ
способом и В ТОМ ЖЕ месте. Совпали красные — свойство копии, а не склейки; вывод несёт дельта ЗЕЛЁНЫХ
(2026-09-13: +5 = ровно новые тесты PR). Обе сюиты гонятся параллельно, ~6,5 мин на каждую.
