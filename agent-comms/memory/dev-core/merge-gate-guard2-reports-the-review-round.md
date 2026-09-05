---
name: merge-gate-guard2-reports-the-review-round
description: "STOP гарда 2 «not green: review=IN_PROGRESS» — это идущий круг ревью, а не красный checks."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6bd88379-bd52-4aa6-be17-50f4d937394a
  modified: 2026-09-05T13:55:53.437Z
---

Гард 2 двери merge называется «green checks on the same head», но в его STOP попадает и состояние
идущего круга ревью: `not green: review=IN_PROGRESS`. Прочитанное как «CI красный», это отправляет
чинить несуществующую красноту.

**Как различить:** `gh run list -c <head>` — если `checks` там `success`, а `Claude PR Review`
`in_progress`, гарды 1 и 2 стоят по ОДНОЙ причине (круг ещё не сказал) и закроются сами с вердиктом.
Находкой это не является и нового коммита не требует.

Рядом: [[merge-gate-guard1-needs-review-workflow-name]] (без `--review-workflow 'Claude PR Review'`
гард 1 врёт), [[green-letter-does-not-mean-still-mergeable]], [[red-ci-names-only-the-first-failing-step]].
