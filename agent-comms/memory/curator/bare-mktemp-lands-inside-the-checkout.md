---
name: bare-mktemp-lands-inside-the-checkout
description: "Голый `mktemp -d` в сессии роли даёт каталог ВНУТРИ основного чекаута — букву «вне рабочего дерева» исполняет только `mktemp -d -p /tmp`"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4465fadb-7652-4a14-8458-43a64a3c1aaf
  modified: 2026-09-04T15:01:45.068Z
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
