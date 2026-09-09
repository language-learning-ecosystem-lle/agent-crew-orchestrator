---
name: gitless-tree-copy-reddens-four-tests
description: "Копия дерева через `git archive` краснит 4 теста, спрашивающих git про свой чекаут — не дефект"
metadata: 
  node_type: memory
  type: project
  originSessionId: bc1d9e6f-2faf-48e7-8261-7a8b862c18e8
  modified: 2026-09-09T18:12:37.431Z
---

Приёмка на СКЛЕЕННОМ дереве (`git archive <tree> | tar -x` в `mktemp -d -p /tmp`) даёт копию БЕЗ `.git`,
и полная сюита краснеет на 4 тестах + 1 ошибке сбора с одной причиной — `fatal: not a git repository`.
Замерено 2026-09-09 на `8762229…` (PR #360): `src/orchestrator/runtime-ignored.test.ts` (2),
`force-stop-delivery.process.test.ts` (2), `build-artifacts-ignored.test.ts` (сбор). Итог был
`4053 passed | 4 failed (4057)`.

**Why:** эти тесты спрашивают git про чекаут, в котором бегут (`check-ignore` по `.orchestrator`/`.worktrees`,
`ls-files`, `rev-parse --show-toplevel`, пуш следа в `origin/comms`). Гонять сюиту в рабочем дереве роли
вместо копии НЕЛЬЗЯ — [[suite-in-a-worktree-breaks-the-contour]], — так что краснота неустранима и её
встретит каждый, кто закрывает ноту сдвига базы по [[base-move-note-answered-by-measure]].

**How to apply:** не подавать эту красноту ни как дефект, ни как «неважное» — исключить СВОЮ руку замером
([[reproduce-with-the-tool-that-measured]], [[own-hand-crutches-hide-the-defect]]): те же файлы на копии
ЧИСТОГО `origin/main`, сделанной тем же способом. Красны те же четыре БЕЗ диффа вообще — значит свойство
копии, а не склейки. Стоит секунды: 3 файла, 3 с.
