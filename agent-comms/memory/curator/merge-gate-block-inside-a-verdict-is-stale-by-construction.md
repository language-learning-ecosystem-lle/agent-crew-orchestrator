---
name: merge-gate-block-inside-a-verdict-is-stale-by-construction
description: "Вывод merge-gate, вклеенный в тело вердикта ревьюера, ВСЕГДА врёт по гардам 1 и 2 — он снят внутри идущего круга"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4c825806-a33b-4c37-aaa7-989aad24b0a8
  modified: 2026-09-17T12:14:52.456Z
---

Ревьюер часто вклеивает в вердикт блок `pnpm protocol merge-gate --pr <N>`. Этот блок снят
ВНУТРИ его собственного круга и ДО доставки его собственного вердикта, поэтому там по построению:
`STOP guard 1 · no approve verdict on <head>` (вердикта ещё нет — его пишет этот самый агент) и
`STOP guard 2 · not green: review=IN_PROGRESS` (круг идёт). Голова та же, PR тот же, а строки
противоположны состоянию ПОСЛЕ вердикта.

Замерено 2026-09-17, PR #461, голова `d02fbedf5` (голова между замерами НЕ двигалась): в теле
вердикта, доставленного в `11:56:29Z`, — два STOP; мой вызов в `12:14Z` — `ok`/`ok`,
`mergeStateStatus` уехал `BLOCKED` → `CLEAN`.

Практическое следствие: **прочитать блок из тела вердикта как состояние PR — значит увидеть отказ
там, где его нет.** Свой вызов двери перед кнопкой не факультативен; и наоборот, STOP гардов 1–2
в теле вердикта никогда не повод считать PR негодным.

Родня: [[pr-state-rots-while-you-measure-it]], [[handoff-letter-is-not-a-state-oracle]],
[[reviewer-verdict-channel-is-its-own]], [[check-state-is-read-from-bucket]].
