---
name: queue-row-promise-of-no-launch-can-be-false
description: "Строка очереди `⛔ OUT OF ATTEMPTS … this row promises no launch` разошлась с планировщиком В ОДНОМ такте — судьбу пары читают строкой ПРОПУСКА и каталогом сессий"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4626d562-b281-4c4b-a8e3-7a8f4d444f89
  modified: 2026-09-13T15:05:39.554Z
---

Строку очереди `daemon.log` нельзя брать как факт о судьбе пары. Замер 13.09 (тред 190): в ОДНОМ
такте строка `queue 1/14: curator×190 · ⛔ OUT OF ATTEMPTS — 8 of 3 failed … the box does NOT raise
it and this row promises no launch; nothing lifts it by itself and no message into that thread lifts
it either`, а шестнадцатью строками ниже, в том же такте, пропуск этой же пары по `box-busy`, не по
`exhausted`. Через четыре такта коробка её **подняла** без руки и без `--max-attempts`.

**Why:** обе печати ключуются на один флаг — строка через `spentCeilings`
(`orchestrator/priority.ts:500`, `.filter((view) => view.exhausted)`), пропуск через `tick.ts:491`
(`if (view?.exhausted)`), и в `tick.ts` проверка `exhausted` стоит ВЫШЕ потолка коробки. Пара с
`exhausted === true` не могла бы дать `box-busy` и тем более запуск. Причина НЕ замерена (открыты
минимум два чтения: разные наборы `views` у строки и планировщика; либо `deliveredToSelf`/`thawed`
меняется между двумя вычислениями внутри такта) — это предмет `dev-core`, `packages/**` чужая зона.

**How to apply:** увидела `⛔ OUT OF ATTEMPTS` — не объявляй пару мёртвой и не строй на этом довод
(мой прошлый ход цитировал такие строки `4 of 3`, `6 of 3`, `5 of 3` как доказательство мёртвых пар).
Сверяй ДВУМЯ фактами того же окна: строкой `candidate … skipped:` того же такта и каталогом
`.orchestrator/sessions/` (файл на каждый подъём). Связано:
[[field-state-is-read-from-the-daemon-log-file]], [[park-run-under-a-review-round-lifts-on-the-verdict]],
[[daemon-log-echoes-your-own-output]].
