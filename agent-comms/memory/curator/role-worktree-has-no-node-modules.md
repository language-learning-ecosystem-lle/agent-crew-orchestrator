---
name: role-worktree-has-no-node-modules
description: "Дерево ПАРЫ поднимается без node_modules — CLI почты не стартует, а симлинк на них делает дерево грязным (R17)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 014b8b28-63d3-4a25-85b6-b9c249b9f570
  modified: 2026-09-09T21:51:04.752Z
---

Рабочее дерево пары (`.worktrees/<role>@<тред>`, устройство с #366) поднимается **без
`node_modules`** — ни в корне, ни в `packages/agent-protocol/`. Первая же команда почты оттуда
умирает: `ERR_MODULE_NOT_FOUND: Cannot find package 'zod'` (замерено 2026-09-09,
`curator@186-collapsing-probe-class-enumerated`).

**Симлинк на `node_modules` главного чекаута чинит запуск и ломает следующий такт:** строка
`.gitignore` — `node_modules/`, со слешем, и **симлинк под неё не подпадает** — `git status`
печатает `?? node_modules`, то есть грязное дерево, то есть отказ запуска роли (R17).
Проверено обеими командами в том же такте.

**Как надо:** гонять `node --import tsx packages/agent-protocol/src/cli.ts …` **из главного
чекаута** (`cd /home/lle/projects/agent-crew-orchestrator`), а корень и ref почты передавать
флагами, как и обычно — команда от места запуска не зависит. Правки файлов при этом остаются в
дереве пары: см. [[absolute-path-edits-hit-the-main-checkout]].

**Why:** без этого первая команда такта отказывает, а «очевидная» починка симлинком тихо
выключает роль на следующем подъёме — цена ошибки не минуты, а целый такт.

**How to apply:** читать и слать почту из главного чекаута; в дереве пары `node_modules` не
заводить ни симлинком, ни `pnpm install`. Прогон чужого дерева на исполнение — копией через
`git archive <sha> | tar -x -C $(mktemp -d -p /tmp)`, и там своя цена: см.
[[gitless-tree-copy-reddens-four-tests]] и [[bare-mktemp-lands-inside-the-checkout]].
