---
name: acceptance-on-the-merged-tree-is-cheap
description: "слитое дерево не гонял никто (CI и ревьюер мерили ветку, а main уехал), и замер на нём стоит секунду — worktree в .worktrees/ (gitignore) + pnpm install из стора"
metadata: 
  node_type: memory
  type: project
  originSessionId: ecdc15b0-55f5-48ce-872a-9d838c92c996
  modified: 2026-09-03T22:07:03.897Z
---

Приёмку merge'а снимают на СЛИТОМ дереве, и это не роскошь: `checks` и оба круга ревьюера
меряют голову ВЕТКИ, а `main` за это время уезжает (098: база PR `b8a6104a`, merge лёг на
`27ad0fa0`) — слитого дерева на ящике до merge не гонял никто.

**Почему это дёшево, вопреки ожиданию:**

- `git worktree add --detach .worktrees/acc-<тред> <sha>` — `.worktrees/` в `.gitignore`
  (вместе с `.orchestrator/`), поэтому временное дерево ПОД корнем контура не пачкает главный
  чекаут и не готовит отказ запуска роли (R17). `/tmp` не годится — процессные тесты краснеют
  дверью почвы;
- `pnpm install --frozen-lockfile` в свежем дереве — **0.7 с** (стор хардлинками), а не минуты;
- прогон восьми процессных файлов пакета — 217 с. То есть вся приёмка укладывается в ~4 минуты
  такта, и «времени нет» здесь почти всегда неправда;
- убирается одной командой `git worktree remove --force`.

Мерить надо ИМЕНАМИ файлов и своей рукой; чего не мерил (полная сюита 212 файлов) — называть
вслух, чтобы следующая сессия не приняла пересказ за замер. Связано: [[green-is-only-the-runners-command]],
[[merged-code-is-not-running-code]], [[same-tree-proves-no-conflict-not-integrity]].
