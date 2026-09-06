---
name: rerun-checks-without-moving-the-head
description: "PAT контура держит `actions=read`: ни `gh run rerun`, ни `workflow_dispatch`; перезапуск `checks` на ТОЙ ЖЕ голове — close+reopen своего PR, а диспатч — рука john"
metadata: 
  node_type: memory
  type: project
  originSessionId: 06e5d1fc-025d-4b00-90eb-562320b755a9
  modified: 2026-09-06T10:04:37.435Z
---

`gh run rerun <id> --failed` под токеном контура **отказывает**: `Resource not accessible by personal
access token` (замерено 2026-09-03, тред `064`, прогон `33778866856`). Права на перезапуск прогонов у
PAT нет, и просить их расширения не надо — есть обход, не двигающий голову.

`.github/workflows/checks.yml` стоит на `on: pull_request` **без сужения `types`**, то есть на
умолчании `opened, synchronize, reopened`. Значит `gh pr close <n>` + `gh pr reopen <n>` поднимает
свежий прогон `checks` с `event=pull_request` на ТОМ ЖЕ `headSha`. Замер: #243, голова
`5020ae02…` не двинулась, красный `33778866856` → зелёный `33780579809`.

**Старый красный из витрины головы НЕ уходит, и гарду 2 это безразлично** (замер 2026-09-06, тред
`135`, #286): после close+reopen в `statusCheckRollup` головы `4761809a` лежат ДВА чека с именем
`checks` — `FAILURE` (`34023859508`) и `SUCCESS` (`34025855399`). Стеклом читается «на голове красный
чек», а дверь отвечает `ok guard 2 · 2 check(s) green: checks=SUCCESS, notify=SKIPPED`, то есть берёт
ПОСЛЕДНИЙ прогон на каждое ИМЯ, а не историю головы. Значит close+reopen — полноценная дверь гарда 2,
а не только способ поднять прогон; читать состояние надо `merge-gate`, иначе годный PR объявляется
красным по витрине.

**Почему именно эта форма, а не пустой коммит:** `synchronize` тоже перезапустил бы прогон, но сдвинул
бы голову — а на голове висит вся арифметика метки и вердикта (метка вешается на ТУ ЖЕ голову, вердикт
относится к коммиту). Пустой коммит платит головой за то, что close/reopen даёт даром.

**Класс шире перезапуска — у PAT нет ВСЕЙ записи в Actions.** Замер 2026-09-06 (тред `064`, приёмка
Т9 смотрителя): `gh workflow run foreign-name-watch.yml --ref <ветка>` → `HTTP 403: Resource not
accessible by personal access token`, а заголовок ответа называет недостающее право дословно —
`X-Accepted-Github-Permissions: actions=write` (чтение прогонов при этом `actions=read`, отсюда
`gh run list` работает). Практическое следствие для постановок: **любая приёмка, чей единственный
живой ход — `workflow_dispatch`, не снимается рукой роли вовсе** и обязана называть исполнителем
john (одна кнопка «Run workflow» в UI Actions) ЕЩЁ В ПОСТАНОВКЕ, а не обнаруживать это в такте
приёмки. Обхода, аналогичного close/reopen, здесь нет: событие `workflow_dispatch` не поднимается
ничем, кроме самого диспатча.

**Why:** красный `checks`, у которого причина вне диффа, иначе стоит либо сдвига головы, либо целого
такта роли на ожидание чужой руки; а приёмка через диспатч — целого такта, кончающегося ничем.

**How to apply:** прежде чем перезапускать — доказать, что дифф ни при чём, тремя командами:
`git diff --name-only <merge-base> <head>` (что в диффе), `git diff --name-only origin/main <head> --
packages .github` (пусто = код побайтно равен зелёному канону), `git rev-parse <ref>:<упавший файл>`
на обоих (один блоб). Зелёный на ТОЙ ЖЕ голове после этого — не «повезло», а доказательство флака.
Нормой close/reopen не является: поведения контура не меняет. Диспатч же перепроверяется одной
строкой `gh api -i -X POST repos/<owner>/<repo>/actions/workflows/<id>/dispatches` — заголовок
`X-Accepted-Github-Permissions` называет право сам, и гадать о причине 403 не нужно. Связано:
[[decision-may-presuppose-a-missing-mechanism]], [[delta-gated-watcher-is-silent-on-a-clean-tree]],
[[green-is-only-the-runners-command]], [[reproduce-with-the-tool-that-measured]],
[[reported-instance-is-a-sample]].

**Из указателя (перенесено 2026-09-06, оглавление шло за потолок):** ни `run rerun`, ни `workflow_dispatch` (403 называет `actions=write` сам); `checks` перезапускается close+reopen, а приёмка через диспатч — кнопка john
