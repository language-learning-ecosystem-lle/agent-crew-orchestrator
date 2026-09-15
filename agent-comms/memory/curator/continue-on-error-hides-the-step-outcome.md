---
name: continue-on-error-hides-the-step-outcome
description: "Шаг под continue-on-error всегда отдаёт conclusion=success в `gh run view --json jobs`; настоящий исход ищется в env СЛЕДУЮЩЕГО шага"
metadata: 
  node_type: memory
  type: reference
  originSessionId: cc666f98-1cca-4475-bb38-3bc213b55e5e
  modified: 2026-09-15T11:57:17.491Z
---

`gh run view <id> --json jobs` поля `outcome` НЕ ОТДАЁТ ВОВСЕ, а `conclusion` у шага с
`continue-on-error: true` всегда `success` — независимо от того, упал шаг или нет. Приёмка,
сформулированная как «`outcome: failure` у шага X», этой командой не мерится и молча читается как
«не сработало».

Где исход лежит на самом деле: в блоке `env` СЛЕДУЮЩЕГО шага, если воркфлоу сам пробрасывает его
переменной (`gh run view <id> --log`, искать `PRIMARY_OUTCOME:` и соседей вроде `LIMIT_HIT`,
`REVIEW_MOVED`). Замерено 15.09 на `claude-review.yml`, прогон `34959992027`: шаг 9 в API
`success`, в `env` шага 10 — `PRIMARY_OUTCOME: failure`.

**Why:** приёмка нового пути пишется ДО того, как путь сработает, и ошибка формулировки всплывает
через сутки — когда мерить уже поздно и подъём оплачен. Здесь спасло только то, что воркфлоу сам
печатал переменную; постановка на это не опиралась.

**How to apply:** формулируя приёмку, называй ИНСТРУМЕНТ и СТРОКУ, которой она читается, и сверяй,
что инструмент такое поле вообще отдаёт. Дословную строку-маркер бери грепом из файла, а не из
памяти о постановке (я ждала «Круг ехал на ЗАПАСНОЙ учётке», в файле — «Круг доехал»). Рядом:
[[reproduce-with-the-tool-that-measured]], [[new-execution-path-is-accepted-by-its-first-firing]],
[[declared-acceptance-rots-by-a-neighbour-fix]].
