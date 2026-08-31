---
name: red-main-checks-may-be-comms-sync
description: "Красный `checks` на main — часто не тесты, а шаг 11 «comms-derived синхронен с каноном»."
metadata: 
  node_type: memory
  type: project
  originSessionId: fa45a9dd-c60a-44b0-be80-69982d17b181
  modified: 2026-08-31T02:57:37.583Z
---

У воркфлоу `checks` есть шаг 11 `comms-derived синхронен с каноном`: он сверяет копию
`.github/workflows/comms-derived.yml` в ветке `comms` с каноном в `main`. Порядок предписан
обратный обычному — копия в `comms` кладётся ДО мержа канонической правки, — поэтому **всё окно
между двумя действиями `main` красный по построению**, а шаг 10 `pnpm test` в нём success.

**Why:** красный `checks` на `main` читается как «тесты сломаны» и толкает искать регрессию в
своём диффе; на деле дифф может быть ни при чём.

**How to apply:** прежде чем копать тесты — `gh api …/actions/runs/<id>/jobs` и посмотреть, какой
ШАГ упал. Упал 11-й — искать открытый PR с канонической правкой воркфлоу (2026-08-31 это был
#169, тред 060) и не трогать: `.github/workflows/**` — док власти, кнопка john.

Замерено 2026-08-31: 13 прогонов `main` подряд красные с 2026-08-30T22:01Z, все на шаге 11.

Связано: [[local-suite-needs-short-tmpdir]].
