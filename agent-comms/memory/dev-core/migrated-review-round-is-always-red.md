---
name: migrated-review-round-is-always-red
description: "Круг, переехавший на запасную учётку, ВСЕГДА `completed/failure` — у основного шага нет `continue-on-error`, и гард 1 такой круг якорем не признаёт."
metadata: 
  node_type: memory
  type: project
  originSessionId: 57aec28d-f068-4ca7-8c4e-9ec2c1092b12
  modified: 2026-09-14T14:58:42.178Z
---

Переезд на запасную учётку спасает ВЕРДИКТ, но не ЦВЕТ круга. Шаг `id: reviewer`
(`anthropics/claude-code-action@v1`, `.github/workflows/claude-review.yml:221`) идёт БЕЗ
`continue-on-error`. Упёрся в лимит — шаг красный, значит красная и вся джоба, хотя запасной шаг
`id: reviewer_fallback` (строка 649) отработал и все шаги доставки зелёные.

А гард 1 `merge-gate` якорем считает круг, у которого `status === "completed" && conclusion ===
"success"` (`packages/agent-protocol/src/merge/gate.ts`, `reviewRunAnchor`). Значит **approve,
доставленный переехавшим кругом, — сирота**, и PR не сядет, сколько бы кругов ни ездило по запасной
учётке: каждый следующий даст ровно тот же красный цвет.

Замер 14.09.2026, круг `34850008811` по #416 (голова `d68ef9135`), шаги по
`actions/runs/<id>/jobs`: `9 Run anthropics/claude-code-action@v1 — completed/failure`,
`11 Ревью на ЗАПАСНОЙ учётке — completed/success`, `14 Доставка вердикта — completed/success`,
`16 Итог доставок — completed/success`, джоба `review — completed/failure`. Вердикт при этом доехал
всеми каналами (`needs-fixes`, письмо в тред).

**Why:** «красный круг» тут читается как авария доставки — и лечится перевеской метки, то есть
ещё одним кругом по той же учётке с тем же исходом. Класс отличается от
[[lost-delivery-receipt-orphans-the-verdict]] (там красит шаг итога доставок) и от
[[failed-review-round-class-lives-in-the-artifact]] (там вердикта нет вовсе): здесь красит
ПЕРВЫЙ шаг, а всё после него зелено.

**How to apply:** увидел красный круг — СНАЧАЛА читай перечень шагов
(`gh api repos/<owner>/<repo>/actions/runs/<id>/jobs --jq '.jobs[].steps[] | "\(.number) \(.name) \(.conclusion)"'`),
а не перевешивай метку. Красный шаг 9 при зелёных 11/14/16 = переезд, и перевеска его не лечит.
Правка — `continue-on-error: true` у `id: reviewer` (или судить исход по `reviewer_out`), но
`.github/workflows/**` — док власти: кнопка john, и постановка идёт через curator. Тождество
входа обоих шагов доказывается отдельно — [[fallback-account-migration-is-proven-by-prompt-identity]].
