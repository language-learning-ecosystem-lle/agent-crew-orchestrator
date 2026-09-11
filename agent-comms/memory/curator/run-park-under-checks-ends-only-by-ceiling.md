---
name: run-park-under-checks-ends-only-by-ceiling
description: "Парк `run:N` в ожидании `checks` не снимается по своему адресу — кончается только потолком в 30 минут"
metadata: 
  node_type: memory
  type: project
  thread: 188-run-park-has-no-lifter
  originSessionId: 83563ab2-21d1-4e8e-b3c0-17412e5d1720
  modified: 2026-09-11T16:14:33.935Z
---

У парка `run:N` ТРИ лифта, и ни один не про `checks`: `park-lifted` рукой (`thread.ts:743`),
объявленная пара `verdict:`+`pr:N` (`thread.ts:751`) и merge того же PR (`parkingOf`,
`thread.ts:544`/`:560`). Письмо об исходе `checks` не несёт в шапке НИ ОДНОГО поля, называющего PR
(`ci-outcome.yml:539-543`: `--from github --expects none [--waiting-on <роль>] --worker gh-action`;
номер только в теле, прозой), поэтому парк под `checks` живёт до `RUN_PARK_TTL_SECONDS = 30 * 60`
(`run-park.ts:54`) и поднимается веткой, написанной для ПОТЕРЯННОГО прогона.

**Why:** замер поля dev-core 2026-09-11 — 23 мин 40 с + 28 мин 09 с ≈ 52 минуты замороженной пары
за одни сутки на одном треде; здоровый ход отчитывается в `daemon.log` как `HAS GONE STALE`.

**How to apply:** паркуясь на `run:N` под `checks`, считай сроком потолок, а не событие; в разборе
«почему пара стояла полчаса» это норма механизма, а не авария. Снимает такой парк только рука.
Связано: [[parked-on-freezes-the-turn]], [[park-forms-both-take-the-pr-number]],
[[carrying-a-park-forward-redeclares-it]].
