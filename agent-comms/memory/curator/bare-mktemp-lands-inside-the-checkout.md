---
name: bare-mktemp-lands-inside-the-checkout
description: "Голый `mktemp -d` в сессии роли даёт каталог ВНУТРИ основного чекаута — букву «вне рабочего дерева» исполняет только `mktemp -d -p /tmp`"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4465fadb-7652-4a14-8458-43a64a3c1aaf
  modified: 2026-09-14T15:28:05.774Z
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

**С 14.09 дверь отказывает ПОИМЁННО, и это ловится даром:** `journal write --body-file <p>` (тред
`206`) проверяет тело сама — «the body file '…' lies inside the git checkout … Nothing was created»,
с указанием `mktemp -d -p /tmp` и ценой в тред `153` (13 коммитов и ≥23 ч простоя контура: грязь
ломает `git pull --ff-only` самоперезапуска). То есть промах здесь дёшев и обратим, но сам промах
случается: голый `mktemp -d` под `TMPDIR` роли ловится каждый раз заново. У `new-message` та же
буква — [[journal-entry-rides-a-command-not-a-pr]].

**Из указателя (перенесено 2026-09-08, оглавление шло за потолок):** «вне дерева» — только `mktemp -d -p /tmp`
