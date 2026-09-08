---
name: metrics-review-section-ignores-since
description: "Число кругов ревью на PR даёт `metrics`, секция `review` — но `--since` её не окном, поэтому «до/после» берётся вычитанием двух снимков."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 371711c6-a1ca-4e15-a3e1-b5626b064967
  modified: 2026-09-08T17:02:18.734Z
---

`agent-protocol metrics --json` → секция **`review`**: `firstRounds`, `redoRounds`,
`reconfirmRounds`, `greenFirstSubmission`, `measuredPrs[]`, `anchorFrom`. Кругов на влитый PR =
`(first + redo + reconfirm) / measuredPrs.length` (замер 2026-09-08: 375/305 = **1.23**).
Прежде чем говорить «механизма под это число нет» — смотреть сюда.

**`--since` эту секцию НЕ окном** (замерено: числа с `--since 2026-09-01` совпали с числами без
флага до единицы, `anchorFrom` остался `2026-08-19T09:13:41Z`; окном режутся `economy`/`day`).
Значит замер «до/после» какой-либо перемены берётся **вычитанием двух снимков** — счётчики
накопительные от якоря, — а не вторым запуском с флагом.

Оборот хода (`handoff-detected` → `lease-acquired`) `metrics` не считает вовсе: это
`scripts/turn-latency.mjs` (PR #347, тред 177). См. [[tick-cost-is-decomposable-from-journals]].
