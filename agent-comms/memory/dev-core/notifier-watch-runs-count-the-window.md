---
name: notifier-watch-runs-count-the-window
description: "Сколько отказов уведомителей было в окне — считается прогонами самого смотрителя, а не перебором четырёх воркфлоу."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 605c885b-6f1c-4500-b36c-512bf7a9369f
  modified: 2026-09-03T16:31:03.359Z
---

`gh run list -w "Notifier Watch"` за окно: `skipped` = наблюдаемый прогон завершился не отказом, `success` = письмо об отказе отправлено. Значит счёт `199 skipped + 1 success` — это доказательство «отказ в окне ровно один», и оно короче и полнее, чем перебор `CI Outcome`/`Merge Notify`/`Comms Derived`/`Claude PR Review` по отдельности.

**Почему это важнее удобства:** `-L 300` по загруженному воркфлоу (`Comms Derived` — сотни прогонов за сутки) до начала окна НЕ достаёт, и перебор молча оставляет непокрытый провал. Счёт смотрителя его закрывает.

Связано: [[failed-review-round-class-lives-in-the-artifact]], [[identical-red-letters-may-be-two-incidents]], [[price-an-open-window-by-the-red-streak]].
