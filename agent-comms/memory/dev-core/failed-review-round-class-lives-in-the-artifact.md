---
name: failed-review-round-class-lives-in-the-artifact
description: "Круг ревью упал без `verdict.md` — класс читается из артефакта прогона (`api_error_status`/`terminal_reason`/`result`), а не из красноты джобы."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 223ad246-6e6a-476c-9b37-094849ea0323
  modified: 2026-09-03T18:56:42.670Z
---

Упавший `Claude PR Review` красит шаг `anthropics/claude-code-action@v1` и шаги доставки, но ПРИЧИНУ в
логе не пишет: там только `Claude execution failed: result is_error:true`. Класс лежит в артефакте
`reviewer-execution-<PR>-<RUN>/claude-execution-output.json` (шаг «Транскрипт ревьюера — артефактом»),
в событии `type: "result"`: поля `api_error_status`, `terminal_reason`, `result`, плюс `num_turns` и
`total_cost_usd` — они и отличают «умер на 7-м ходу за 20 секунд» от «не уложился в ходы».

Полевой случай 2026-09-03, PR #239, прогон `33762234440`: `api_error_status: 429`,
`terminal_reason: api_error`, `result: "You've hit your session limit · resets 1:40pm (UTC)"`, 7 ходов,
$0.09. То есть НЕ H2 (уход в фон даёт `success` без `is_error`), не дефект воркфлоу и не суждение о PR.

**Класс не разовый:** в те же сутки он повторился — PR #247, прогон `33787502420`, тот же `429`,
`resets 6:40pm (UTC)`, но уже 28 ходов и $0.60. Значит цена одной несостоявшейся попытки скачет на
порядок, и «повторить» — не бесплатное действие. Две подряд одинаковые аварии на одном PR — уже не
повтор, а расход: вопрос идёт к curator, а не решается третьим перевешиванием метки.

**Why:** автоповтора у круга нет намеренно (решение john, тред 029) — «сначала класс считается, потом
решается, платить ли за вторую попытку». Без артефакта считать нечем, и перевешивание метки становится
ставкой вслепую: препятствие, ограниченное во времени (429 со сроком сброса), и системный дефект
воркфлоу выглядят в логе ОДИНАКОВО.

**How to apply:** `gh run download <RUN> -R language-learning-ecosystem-lle/agent-crew-orchestrator -D
<dir>` — **`-R` обязателен**, из `/tmp` без него `gh` падает «not a git repository». Дальше — читать
`type: "result"` (файл — массив событий). Названный в `result` срок сброса уже прошёл → повтор законен,
и основание пишется в тред числом, а не словом «попробую ещё». Класс называть письмом: см.
[[identical-red-letters-may-be-two-incidents]], а перевешивать метку — только по
[[green-letter-does-not-mean-still-mergeable]] и [[label-follows-base-note-not-clean]].
