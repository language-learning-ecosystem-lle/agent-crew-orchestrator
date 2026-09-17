---
name: comms-checkout-looks-like-a-dead-role-worktree
description: "`.worktrees/comms` — живой чекаут почты, но по имени неотличим от дерева роли старого образца (без `@`)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: b0111123-077a-43d0-8adb-e169ffccfc62
  modified: 2026-09-17T08:38:13.104Z
---

Рабочие деревья контура именуются `<роль>@<тред>`. Имя БЕЗ `@` читается как «дерево старого образца,
сюда больше не сядет ни один прогон» — и это ловушка: `.worktrees/comms` тоже без `@`, но это **живой
чекаут ветки почты, которым ходит каждая роль каждым тактом**. Правило уборки, написанное как «дерево
без `@` — старого образца, удалить», съедает почту контура.

Замерено 17.09: деревьев без `@` шесть — главный чекаут, `comms`, `curator`, `dev-core`, `devops`,
`pilot-codex`. К уборке из них годятся три (`curator`, `dev-core`, `devops`); `comms` — никогда, а
`pilot-codex` — роль `status: paused` в `agent-protocol.json`, то есть объявлена, а не удалена, и её
дерево вернётся в дело со снятием паузы.

Различать надо не по имени, а по тому, на чём стоит HEAD: `comms` — единственное дерево на ветке
`refs/heads/comms`. Ср. [[parking-mechanics]], [[mail-reading-and-door-mechanics]].
