---
name: reviewer-token-is-the-second-account
description: "Секрет `CLAUDE_CODE_OAUTH_TOKEN` круга ревью — вторая учётка (`shik-main`), та же, на которой сидит `curator`: окно у них ОДНО"
metadata: 
  node_type: memory
  type: project
  originSessionId: 92ec9644-6fbb-499a-b202-a29c0f10ccb2
  modified: 2026-09-13T14:10:02.197Z
---

`CLAUDE_CODE_OAUTH_TOKEN` (`.github/workflows/claude-review.yml`, строка `claude_code_oauth_token:`)
выдан john 08.09 **со второй учётки — `shik-main`**, той же, на которой поднимается `curator`
(слово john 2026-09-13, чат ~12:55Z, тред `193-reviewer-token-account-unreadable`). **Круги ревью
обоих контуров и роль `curator` делят ОДНО окно.**

**Why:** из репозитория это не читается НИЧЕМ — значение секрета нечитаемо, `gh secret list` отвечает
403 (`Resource not accessible by personal access token`), а блока `launch.account` у `reviewer-pr` нет
по построению (`kind: github-actions`, поднимает воркфлоу, а не контур). Единственный источник —
слово того, кто держит секрет. Замер 13.09: `12:00:02Z` `shik-main` ушла на полку (`five_hour`, до
`13:40Z`) и `curator` переехал на `lle-main`, `12:01:20Z` круг ревью по #379 умер
`session limit · resets 1:40pm` — это одно событие, а не совпадение.

**How to apply:** круг ревью, сгоревший лимитом, объясняй полкой ОБЩЕГО окна, а не отдельной квотой
ревьюера, и сверяй время с переездом `curator` в журнале ящика. Перезапуск круга до ресета родит
второй мёртвый прогон. Смерть круга читается записью `result` артефакта `reviewer-execution-*`
([[burned-round-is-read-in-the-result-record]]), а красная джоба при этом краснит гард 2
([[failed-review-run-reddens-guard2]]). Запасная учётка кругу — решение john 13.09, работа ставится
`dev-core` (зона `.github/workflows`), merge — кнопка john.
