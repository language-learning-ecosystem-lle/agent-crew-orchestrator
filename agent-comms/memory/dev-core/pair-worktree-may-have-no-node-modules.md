---
name: pair-worktree-may-have-no-node-modules
description: "В дереве ПАРЫ (`.worktrees/<role>@<thread>`) `node_modules` может отсутствовать — команды почты оттуда падают `ERR_MODULE_NOT_FOUND: zod`, гонять их из главного чекаута."
metadata: 
  node_type: memory
  type: project
  originSessionId: a8c8efd3-df7a-4b24-a743-68ebbe67a437
  modified: 2026-09-09T21:39:39.137Z
---

Рабочее место роли-пары (`.worktrees/dev-core@186-…`) бывает БЕЗ `node_modules` вовсе, и тогда
первая же документированная команда почты (`node --import tsx packages/agent-protocol/src/cli.ts
thread show …`) падает не по делу:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod' imported from
  …/.worktrees/dev-core@186-…/packages/agent-protocol/src/config/config.ts
```

Это НЕ «файла в чекауте ещё нет» (тот диагноз — из главного чекаута,
см. [[documented-command-must-run-from-the-role-workplace]]) и не дефект команды: в дереве просто
нет ни корневого, ни пакетного `node_modules`. Та же команда из `/home/lle/projects/agent-crew-orchestrator`
работает сразу — почта читается по `--root`/`--ref`, поэтому МЕСТО запуска её ответу безразлично.

**Замер 2026-09-09 (такт треда 186):** из восьми деревьев `.worktrees/**` `node_modules` есть у всех
одиночных (`dev-core`, `curator`, `devops`, `comms`, `pilot-codex`) и у `dev-core@184`, но НЕТ у
`dev-core@186` и `curator@161`. То есть у деревьев пары наличие зависимостей не гарантировано —
на что попадёшь, тем и меряется такт.

**How to apply:** упало `ERR_MODULE_NOT_FOUND` в рабочем месте — не лечи `pnpm install` (лишние
минуты и грязь в дереве под R17), а гони команды почты из главного чекаута контура. Но
[[green-depends-on-where-the-checkout-lives]] отсюда НЕ отменяется: сюиту и процессные тесты место
запуска решает, и их гонять всё равно в дереве контура — из главного чекаута дерево твоей ветки
меряется детач-чекаутом ([[run-an-unmerged-door-by-detach-checkout]]).
