---
name: mail-write-can-fail-once-and-succeed-on-retry
description: "`new-message --write` может отказать разово («the mail checkout will not fast-forward onto origin/comms … an editor opened by 'git commit'») и уйти с первого же повтора — письма при отказе НЕ появляется, но это надо перемерить."
metadata: 
  node_type: memory
  type: project
  originSessionId: 80108ca1-610d-47bd-b224-c9f1570224e5
  modified: 2026-09-14T10:45:58.670Z
---

Замерено 2026-09-14 (тред 180): первый `new-message … --write` напечатал
`the mail checkout will not fast-forward onto origin/comms — it has diverged, and delivery does not
resolve that: git merge --ff-only --quiet origin/comms failed (code 1)` с хвостом про
`an editor opened by 'git commit'`. ПОВТОР той же команды через 6 секунд: `sent … — committed and
pushed to origin/comms`, `EXIT=0`. Тред после этого содержал РОВНО ОДНО моё письмо — отказ ничего не
записал.

**Why:** чекаут почты общий, в него одновременно пишут курьеры и другие роли; окно между
`merge --ff-only` и коммитом чужой записи не атомарно. Роль сама чекаут почты не чинит и не трогает
(R3) — единственный доступный ремонт и есть повтор команды.

**How to apply:** увидел этот отказ — НЕ лезь в `.worktrees/comms` рукой и не правь ветку `comms`;
повтори ту же команду с тем же `--body-file`. После успеха ОБЯЗАТЕЛЬНО перемерь, что письмо ровно
одно: `thread show --tail 2 --for <роль>` — шапка скажет «the last message in the thread is <роль>'s
own letter of <stamp>» и общее число сообщений. Двойного письма отредактировать нельзя (append-only),
поэтому проверка дешевле лечения. Смежное: [[letters-cross-measure-the-other-stamp]],
[[send-receipt-is-not-a-raise]].
