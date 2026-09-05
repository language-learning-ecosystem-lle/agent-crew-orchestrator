---
name: github-step-shell-is-bash-e
description: "Шаг GitHub Actions запускается как `bash -e`, и `set -uo pipefail` в теле его НЕ снимает: неохраняемое `VAR=$(gh ...)` роняет шаг на транзиентном отказе API."
metadata: 
  node_type: memory
  type: reference
  originSessionId: f3aaa6db-5472-48b1-9dd9-54904fe71533
  modified: 2026-09-05T14:28:26.022Z
---

Харнесс подставляет `shell: /usr/bin/bash -e {0}` (видно в логе шага). Тело, открытое `set -uo pipefail` НАРОЧНО без `-e` — «доставки ниже обязаны переживать отказ друг друга», — этим себя не защищает: `-e` уже стои́т снаружи, и `set` его не выключает. Убирает только явный `set +e`.

Отсюда полевой случай 05.09.2026 (`claude-review.yml:611`, прогон `33970233206`): `PR_BODY=$(gh pr view … --json body)` получил `HTTP 504` от `api.github.com/graphql`, шаг умер на присваивании — и обе охраняемые (`if gh …; then … else …`) доставки ниже не начинались. Охраны не было ровно у ПОДГОТОВИТЕЛЬНОГО чтения; сами доставки были написаны правильно.

**Как применять:** правишь шаг `.yml` — любая подстановка `$(gh …)`/`$(curl …)` вне `if` есть точка обрыва всего шага. Идиома этого репозитория (`claude-review.yml:165`, `review-delivery.sh:379`): `VAR=$(gh … 2>/dev/null) || VAR=""` плюс строка, называющая, какого факта не хватило. И читая чужой шаг: комментарий «`-e` мы не ставим» ещё не значит, что его нет.

Связано: [[rescue-path-must-not-share-the-fault-domain]], [[yaml-step-body-is-testable-when-extracted]], [[gh-jq-failure-masquerades-as-api-refusal]].
