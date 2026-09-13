---
name: courier-calls-for-a-label-on-journal-prs
description: "Письмо о зелёном `checks` зовёт вешать метку `review` даже на чисто журнальный PR — зов исполнять нельзя, и отказ называется вслух."
metadata: 
  node_type: memory
  type: project
  thread: 187-journal-rides-along
  originSessionId: 80d24c49-63a2-4ceb-ab4c-9f17fe82a11a
  modified: 2026-09-13T12:10:26.768Z
---

Курьер (`.github/workflows/ci-outcome.yml`) об исключении нормы 11.09 не знает: `grep -rn journal .github/workflows/` — пусто. На зелёный `checks` он ставит `LABEL_CALL=1` и печатает «👉 …метка `review` …вешается …сейчас. Ход у автора ровно на это одно действие», а ход передаёт АВТОРУ PR. Исключение у зова ровно одно — дифф, правящий `claude-review.yml`.

**Why:** на диффе, все пути которого в `docs/journal/**`, круг ревью норма отменяет (слово john 11.09, тред `187-journal-rides-along`), и дверь это уже умеет (`merge-gate --journals docs/journal`). Исполненный зов поднял бы НАСТОЯЩИЙ круг (фильтра путей в `claude-review.yml` нет) — подъём ревьюера, вердикт, письмо, прогон, метка и merge ради абзаца хроники.

**How to apply:** метку не вешать; в письме сказать ВСЛУХ, что зов не исполнен и почему (молчание читается как забывчивость автора, а не как норма), и передать ход держателю кнопки — curator мержит такой PR дверью с `--journals docs/journal`. Подъём, который этот зов вызывает, всё равно случится: он пустой, и это ожидаемо, а не авария. Связано: [[green-pr-checks-writes-a-letter]], [[do-not-park-on-a-green-ci-run]].
