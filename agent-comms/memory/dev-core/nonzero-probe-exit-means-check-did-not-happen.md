---
name: nonzero-probe-exit-means-check-did-not-happen
description: "Ненулевой код у команды-зонда значит «сверка не состоялась», а не «ответ — нет»: шаг напечатал «роли нет в конфиге» на версионный отказ"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e1f13489-af94-4d46-a77d-db3d056176d1
  modified: 2026-09-07T14:03:34.892Z
---

`if ! cli role exists …; then echo "роли нет в конфиге"` — печатает ВЫВОД, а не факт. Замерено
2026-09-07 (прогон 34127384968): `role exists` отказал версионной дверью (`the package writes 26`),
и шаг доложил «в описании PR названа роль 'dev-core', которой нет в конфиге протокола». Роль в
конфиге была.

**Why:** у зонда два разных исхода схлопнуты в один код: «сверка прошла, ответ нет» и «сверка не
состоялась». Второй маскируется под первый и уводит починку в другую подсистему — соврала дверь, а
искать пошли бы конфиг ролей.

**How to apply:** ловить вывод (`answer=$(… 2>&1)`) и ЦИТИРОВАТЬ его в отказе дословно, схлопнув
переводы строк (иначе `::warning::` обрежется первой строкой); формулировать «X НЕ СВЕРИЛСЯ», а не
«X нет». Тот же класс живёт в `merge-notify.yml`, `ci-outcome.yml`, `claude-review.yml`.
Родня: [[schema-bump-breaks-own-cli-from-the-branch]], [[gh-jq-failure-masquerades-as-api-refusal]],
[[red-ci-names-only-the-first-failing-step]].
