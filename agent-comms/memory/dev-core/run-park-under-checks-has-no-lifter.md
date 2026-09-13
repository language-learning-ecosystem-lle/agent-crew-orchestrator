---
name: run-park-under-checks-has-no-lifter
description: "Парк run:N под `checks` С 13.09.2026 снимается полем `run-outcome` письма об исходе — и лифт поднимает АВТОРА, а не кнопку."
metadata: 
  node_type: memory
  type: project
  originSessionId: 670bae20-6228-4b9e-986a-d4a70a99daaf
  modified: 2026-09-13T17:05:19.444Z
---

**Почин­ка приземлилась: #383 (`e25da912c`, тред 188) влит 2026-09-13T16:58:46Z.** `judgeParkSeen`
(`thread/park-seen.ts`) снимает `run:N` тремя полями: `verdict:`+`pr:N`, `merged-pr: N` и
**`run-outcome: N`**; последнее пишет машинный писатель `.github/workflows/ci-outcome.yml`
(`OUTCOME_ARGS=(--run-outcome "$PR")`, пустой набор на красном main, где PR-адресата нет). До этого
дня парк под `checks` не имел подъёмника вовсе и стоял до потолка `RUN_PARK_TTL_SECONDS` (30 мин):
замерено в 187 двумя случаями — 23 мин 40 с и 28 мин 09 с, ~52 мин мёртвой пары за сутки.

**Why:** до формы (б) дверь ОБЕЩАЛА машинному писателю лифт «по номеру события», и обещание было
правдой про `pr:` парки и ложью про `run:` под `checks` — исход `checks` вердикта не объявляет.

**How to apply:** парк `run:N` под идущим `checks` теперь честен — он гасит бесполезный подъём под
красный/идущий прогон и лопается ровно письмом об исходе, а не потолком. **Но считай, КОГО поднимет
лифт:** то же письмо `ci-outcome` ставит `--waiting-on <роль из `role:` описания PR>`, когда есть
`LABEL_CALL`/`ACTIONABLE` — то есть АВТОРА, а не держателя кнопки. На журнальном PR (где метка
`not asked`) это подъём автора ровно на «перемерить дверь и передать ход curator». `pr:N` парк
`run-outcome` НЕ снимает (сказано в README явно) — его адрес только `merged-pr: N`.
Про требование живого прогона — [[do-not-park-on-a-green-ci-run]]; про потолок —
[[carrying-a-park-forward-does-not-restart-its-ceiling]]; выбор формы — [[park-pr-vs-run-choice]].
