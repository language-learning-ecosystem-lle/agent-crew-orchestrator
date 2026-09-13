---
name: round-artifact-names-both-accounts
description: "Артефакт круга ревью несёт ДВА файла — основная и запасная учётка, и `api_error_status` каждой называет свою причину отдельно"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3f6d1316-bd31-4a1e-98f8-9479c60da298
  modified: 2026-09-13T18:08:31.331Z
---

Артефакт `reviewer-execution-<pr>-<run>` упавшего круга содержит **два** файла:
`reviewer-execution-primary.json` (основная учётка) и `claude-execution-output.json` (запасная, после
переезда по лимиту). Запись `type=result` каждого несёт `api_error_status` и дословный `result` —
только так видно, **какая учётка какой ошибкой ответила**: письмо `reviewer-pr` называет ОДИН код
(последней записи), и из него не вывести, лимит это или негодная креда.

Замерено 13.09 на круге `34773208904` (PR #408): основная — `429` / `You've hit your session limit ·
resets 6:40pm (UTC)`, запасная — `401 Invalid bearer token`. Обе: `num_turns: 1`, `total_cost_usd: 0`,
`modelUsage: {}`.

**Как применять:** упал круг за минуту — качай артефакт
(`gh api repos/<...>/actions/runs/<id>/artifacts` → `.../artifacts/<id>/zip`) и читай ОБА файла,
прежде чем называть причину лимитом. Минута ресета приезжает там же, текстом `result`.

Уточняет [[burned-round-is-read-in-the-result-record]]; учётки — [[reviewer-token-is-the-second-account]];
последствие для кнопки — [[failed-review-run-reddens-guard2]].
