---
name: workflow-wiring-is-pinned-by-a-delivery-integration-suite
description: "Проводка claude-review.yml пиньётся ассертом в .github/scripts/review-delivery.integration.sh — грепать `steps\\.<id>` ДО пуша"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9001c717-9f1e-4f54-8dd4-e290dab42098
  modified: 2026-09-13T15:38:07.200Z
---

Утверждение «тестов над воркфлоу в репозитории нет» ложно: `.github/scripts/review-delivery.integration.sh`
вынимает тело шага «Итог доставок» из `claude-review.yml` и сверяет его `env:` ДОСЛОВНО
(`'${{ steps.reviewer.outputs.execution_file }}'`). Перевод потребителя на другой шаг краснит
`checks` шага «доставка вердикта — интеграционная сюита», состояние `10-13`.

**Why:** пин не находится ни грепом по `.yml`, ни `actionlint` (его нет); цена находки после пуша —
полный прогон `checks` (замерено 2026-09-13, прогон 34763198375).

**How to apply:** правя проводку `claude-review.yml` (`steps.<id>.outputs.*`), до пуша гонять
`grep -rn 'steps\.<id>' .github/scripts` и чинить пин ПРАВКОЙ ожидаемого значения, а не снятием
ассерта. Сюита гоняется локально целиком: `TMPDIR=/tmp bash .github/scripts/review-delivery.integration.sh`
(~40 с, 17 состояний) — это даровой оракул на весь шаг CI. См. [[door-defects-hide-in-process-tests]],
[[yaml-step-body-is-testable-when-extracted]].
