---
name: runs-on-a-head-need-the-head-sha-param
description: "Перечень прогонов головы берётся параметром head_sha= у API, а не фильтром --jq по общему списку — тот молча даёт пустоту"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 3901a4b7-4fb4-4ef2-bc52-1c13e265da5c
  modified: 2026-09-14T09:54:02.399Z
---

`gh api repos/<o>/<r>/actions/runs --jq '[.workflow_runs[]|select(.head_sha=="<SHA>")]'` вернул `[]`
на голове, где прогон БЫЛ (14.09, #410, голова `20c46a2a6`): общий список отдаёт первую страницу
(30 записей), и нужная в неё не попала. Правильно — сузить НА СТОРОНЕ API:
`gh api "…/actions/runs?head_sha=<SHA>&per_page=50" --jq '.workflow_runs[] | "\(.name)\t\(.status)\t\(.conclusion)\t\(.id)"'`.

**Why:** пустой ответ здесь неотличим от факта «на этой голове прогонов нет» — а из него растут
ровно те выводы, которыми роль двигает маршрут: «`checks` не зелёный → метку не вешать» и «круга на
голове нет → перевесить метку». Оба ложны и оба дорогие: второй жжёт круг.

**How to apply:** любой вопрос «что бежало/закрылось на ЭТОЙ голове» задавать параметром `head_sha=`;
пустой ответ от такого запроса — уже ответ. Тот же класс, что [[gh-jq-failure-masquerades-as-api-refusal]]:
дефект своего запроса рядится в факт о мире. Родня: [[run-headsha-does-not-name-the-code-it-ran]],
[[merge-gate-guard1-needs-review-workflow-name]].
