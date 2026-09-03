---
name: rerun-checks-without-moving-the-head
description: "Токен контура не умеет `gh run rerun`; перезапуск `checks` на ТОЙ ЖЕ голове делается закрытием и переоткрытием своего PR"
metadata: 
  node_type: memory
  type: project
  originSessionId: 06e5d1fc-025d-4b00-90eb-562320b755a9
  modified: 2026-09-03T16:56:17.446Z
---

`gh run rerun <id> --failed` под токеном контура **отказывает**: `Resource not accessible by personal
access token` (замерено 2026-09-03, тред `064`, прогон `33778866856`). Права на перезапуск прогонов у
PAT нет, и просить их расширения не надо — есть обход, не двигающий голову.

`.github/workflows/checks.yml` стоит на `on: pull_request` **без сужения `types`**, то есть на
умолчании `opened, synchronize, reopened`. Значит `gh pr close <n>` + `gh pr reopen <n>` поднимает
свежий прогон `checks` с `event=pull_request` на ТОМ ЖЕ `headSha`. Замер: #243, голова
`5020ae02…` не двинулась, красный `33778866856` → зелёный `33780579809`.

**Почему именно эта форма, а не пустой коммит:** `synchronize` тоже перезапустил бы прогон, но сдвинул
бы голову — а на голове висит вся арифметика метки и вердикта (метка вешается на ТУ ЖЕ голову, вердикт
относится к коммиту). Пустой коммит платит головой за то, что close/reopen даёт даром.

**Why:** красный `checks`, у которого причина вне диффа, иначе стоит либо сдвига головы, либо целого
такта роли на ожидание чужой руки.

**How to apply:** прежде чем перезапускать — доказать, что дифф ни при чём, тремя командами:
`git diff --name-only <merge-base> <head>` (что в диффе), `git diff --name-only origin/main <head> --
packages .github` (пусто = код побайтно равен зелёному канону), `git rev-parse <ref>:<упавший файл>`
на обоих (один блоб). Зелёный на ТОЙ ЖЕ голове после этого — не «повезло», а доказательство флака.
Нормой close/reopen не является: поведения контура не меняет. Связано:
[[green-is-only-the-runners-command]], [[reproduce-with-the-tool-that-measured]],
[[reported-instance-is-a-sample]].
