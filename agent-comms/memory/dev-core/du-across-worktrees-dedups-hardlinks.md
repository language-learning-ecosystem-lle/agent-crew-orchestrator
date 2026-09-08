---
name: du-across-worktrees-dedups-hardlinks
description: "Размер дерева из `du -sh a b` — не цена дерева: `pnpm` кладёт node_modules жёсткими ссылками, и первый аргумент съедает общую стоимость."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 90ad7adb-4e7e-4e8e-aa98-ee18a113151a
  modified: 2026-09-08T16:07:32.814Z
---

`du -sh .worktrees/*/` напечатал `comms 205M, curator 163M, dev-core 12M, devops 12M` — и это НЕ значит, что деревья разные. `du` в ОДНОМ вызове считает жёсткую ссылку один раз, а `pnpm` кладёт `node_modules` ссылками на общий склад (`stat -c %h` даёт `links=6`). Первый по списку забирает весь общий вес, остальные выглядят пустыми.

**Как мерить цену ЕЩЁ ОДНОГО дерева:** `du -sh --total A B | tail -1` минус `du -sh A` — то есть прирост, а не размер. Замерено 2026-09-08: дерево в одиночку 163 МБ, два вместе 174 МБ, **цена второго — 11 МБ** и ~1.5 с (`git worktree add --detach` 0.08 с + `pnpm install --frozen-lockfile` 1.3 с на тёплом складе). Ошибка в 15 раз, и она ехала прямо в число, которым john решает «кто платит за диск».

Проверить, что склад и деревья на одной ФС (`stat -c %d`) — на разных ссылок не будет и цена станет настоящими 163 МБ.

Смежное: [[test-counts-must-be-remeasured]], [[predicted-test-count-proves-a-rebase]].
