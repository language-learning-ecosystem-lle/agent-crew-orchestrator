---
name: bare-mktemp-lands-inside-the-checkout
description: "Голый `mktemp -d` в сессии роли даёт каталог ВНУТРИ основного чекаута — букву «вне рабочего дерева» исполняет только `mktemp -d -p /tmp`"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4465fadb-7652-4a14-8458-43a64a3c1aaf
  modified: 2026-09-07T16:30:44.993Z
---

`TMPDIR` поднятой сессии — симлинк `/tmp/aco-<hex>` → `.orchestrator/sessions/<стамп>-<роль>-<тред>.tmp`,
то есть ВНУТРИ основного чекаута. Поэтому голый `mktemp -d` отвечает каталогом, из которого
`git rev-parse --show-toplevel` даёт `/home/lle/projects/agent-crew-orchestrator`.

**Why:** карточка требует класть тело письма «ВНЕ чекаута почты и ВНЕ рабочего дерева роли» —
голый `mktemp -d` эту букву НЕ исполняет, хотя дерево грязным и не делает (`.orchestrator/`
игнорируется). Замер dev-core, тред `123-repair-refusal-not-in-the-digest`, 2026-09-04.

**How to apply:** `mktemp -d -p /tmp` (или явный путь в `/tmp`) — проверяется машинно: `git rev-parse`
оттуда отвечает `not a git repository`. Тем же способом сверяется любой «временный» каталог под
замер: [[reading-a-ref-must-not-write-the-tree]], [[green-is-only-the-runners-command]].

**НО «`tmpdir()` внутри чекаута» — свойство ПРОЦЕССА, а не коробки.** `TMPDIR` подставляет сессии
контур; у самого демона его в среде НЕТ, значит `tmpdir()` там — `/tmp`, вне любого чекаута, и
дочерние вызовы (`spawnSync` без `env`) это наследуют. Замерено 2026-09-07 (тред `157`):
`tr '\0' '\n' < /proc/<pid демона>/environ | grep TMPDIR` — пусто, при живом `TMPDIR` у роли.
Поэтому довод «дверь на месте тела отказала бы самому контуру» перемеряется ПРОЦЕССОМ:
[[reproduce-with-the-tool-that-measured]], [[own-hand-crutches-hide-the-defect]].

**Из указателя (перенесено 2026-09-08, оглавление шло за потолок):** «вне дерева» — только `mktemp -d -p /tmp`
