---
name: session-shell-has-no-node-on-path
description: "В оболочке поднятой сессии curator НЕТ `node` на PATH — первая же команда почты падает `node: command not found`"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 867e2bac-70cc-4d48-aae8-49ac27c03d31
  modified: 2026-09-17T17:21:08.114Z
---

Замерено 17.09 в такте `222`: оболочка поднятой сессии стартует с
`PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin`, и `node` там нет
вовсе — первая же команда из промпта (`node --import tsx packages/agent-protocol/src/cli.ts …`)
падает `node: command not found`.

Интерпретатор живёт в доме контура, **читать который сессии нельзя** (`ls /home/lle` →
`Permission denied`, сессия под `aco-hetzner`), но сам каталог bin открыт:

```
/home/lle/.nvm/versions/node/v24.18.0/bin   # node, npm, pnpm, npx, claude, codex
```

Практика: первой строкой такта `export PATH=/home/lle/.nvm/versions/node/v24.18.0/bin:$PATH` — и
дальше все команды пакета работают как в промпте. Голый `find / -name node` этого НЕ находит
(обход чужого дома запрещён), поэтому искать надо сразу по этому пути.

Это НЕ тот дефект, что чинил тред `219`/#464: там `PATH` правился у инструмента, который спавнит
демон; оболочка агентской сессии осталась как была. Версия каталога может уехать — если пути нет,
`ls -d /home/lle/.nvm/versions/node/*/bin` даёт актуальный.

Родня: [[role-worktree-has-no-node-modules]], [[contour-git-identity-lives-in-one-home]].
