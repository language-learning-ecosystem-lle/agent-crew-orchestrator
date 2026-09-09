---
name: killed-suite-leaves-a-file-in-the-tree
description: "Убитый на полпути прогон сюиты оставляет в рабочем дереве `.github/scripts/remote.txt`, и `git add -A` уносит его в коммит."
metadata: 
  node_type: memory
  type: project
  originSessionId: 1570e2ad-0a99-408c-a985-d9467d5d548a
  modified: 2026-09-09T16:54:09.598Z
---

Полный `vitest run --root packages/agent-protocol`, УБИТЫЙ посреди прогона, оставляет в рабочем
дереве `.github/scripts/remote.txt` — одну строку с фиктивной заглушкой вида
`https://x-access-token:t0ken@github.com/lle/repo`. Досчитанный до конца прогон дерево оставляет
чистым: файл временный, шелл-тест убирает его за собой на нормальном выходе.

**Why:** замерено 2026-09-09 обеими сторонами — после `TaskStop` по прогону файл был в дереве и
уехал в коммит первым же `git add -A` (вынимал `git rm --cached`); после досчитанного прогона
`git status --porcelain -uall` пуст. Грязное рабочее место — отказ запуска роли на следующем
такте, а файл выглядит как утёкший токен в диффе, хотя токен фиктивный.

**How to apply:** прогон сюиты не убивать на полпути; если убил (перебазировка под ним, смена
головы) — `git status --porcelain -uall` ДО `git add`, и коммитить только названные пути.
Смежное: [[probe-copy-pollutes-the-full-suite]], [[test-counts-must-be-remeasured]].
