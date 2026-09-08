---
name: check-state-is-read-from-bucket
description: "`gh pr checks --json state` отдаёт `IN_PROGRESS`, а не `PENDING`: цикл `until [ state != PENDING ]` выходит МГНОВЕННО на ещё бегущем прогоне и молча врёт в сторону «чеки готовы»; незавершённость спрашивают полем `bucket` (`pending`/`pass`/`fail`)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 16748be9-1ae9-43ee-8d2a-e61cb99297d2
  modified: 2026-09-08T14:13:32.778Z
---

Гард 2 требует зелёного на ТОЙ ЖЕ голове, и состояние прогона приходится ждать циклом. У `gh` в этом
месте ДВА поля с разными словарями, и наивное имя ведёт к тихой лжи:

- `gh pr checks <n> --json state` → `IN_PROGRESS` / `SUCCESS` / `FAILURE`;
- `gh pr checks <n> --json bucket` → `pending` / `pass` / `fail`;
- `gh pr view <n> --json statusCheckRollup` → `.status` = `IN_PROGRESS`, `.conclusion` = `""`, а
  `completedAt` у незавершённого равен `0001-01-01T00:00:00Z`, не пустой строке и не `null`.

**Замерено 2026-09-08, тред 173, PR #342.** `until [ "$(gh pr checks 342 --json state --jq '.[0].state')" != "PENDING" ]`
вышел на ПЕРВОЙ итерации, притом что прогон бежал ещё полторы минуты: слова `PENDING` в словаре
`state` нет вовсе, поэтому условие истинно всегда. Отказ молчит и деградирует в опасную сторону —
«ждать больше нечего», то есть ровно в сторону метки `review` на незелёной голове (а метка после
незелёного — нарушение маршрута, и круг она потратит впустую).

Рабочие формы: `until [ "$(gh pr checks <n> --json bucket --jq '.[0].bucket')" != "pending" ]`, либо
по `statusCheckRollup[0].status != "IN_PROGRESS"`. Обе — фоном (`run_in_background`), а не
foreground-ожиданием: `checks` в тред НЕ пишет сам, пока не повешена метка, поэтому это своё
короткое чтение, а не чужой прогон (ср. [[reviewer-verdict-channel-is-its-own]]). Прогон `checks`
здесь идёт ~8 минут — это меряется даром: `gh run list --workflow checks.yml --json startedAt,updatedAt`.

**Общее правило под случаем:** свой ноль/выход из цикла подпирать КОНТРОЛЬНЫМ совпадением — один раз
напечатать фактическое значение поля, прежде чем строить на нём условие
(ср. [[verify-the-grep-pattern-not-its-result]], [[green-is-only-the-runners-command]]).
