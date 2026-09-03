---
name: write-a-branch-without-checking-it-out
description: "Коммит в ветку, которую нельзя чекаутить (comms), собирается плумбингом во временном индексе и пушится по SHA."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8b40dc2c-5ced-430c-913f-66412e7b996a
  modified: 2026-09-03T10:46:35.219Z
---

Положить один файл в ветку `comms` (путь ВНЕ `agent-comms/**` — например
`.github/workflows/comms-derived.yml`) можно не заходя ни в чекаут почты, ни в свою ветку:

```
export GIT_INDEX_FILE=/tmp/idx.$$
git read-tree origin/comms
git update-index --add --cacheinfo 100644,<blob>,<path>
TREE=$(git write-tree); unset GIT_INDEX_FILE
COMMIT=$(printf '%s\n' "заголовок" "" "тело" | git commit-tree "$TREE" -p origin/comms)
git push origin "$COMMIT":refs/heads/comms
```

**Why:** чекаут почты — рабочее место чужой роли, а свой воркспейс после `checkout comms`
пришлось бы возвращать; грязное дерево = отказ запуска на следующем такте. Плумбинг не трогает
ни то, ни другое, а блоб уже лежит в объектной базе после ребейза своей ветки.

**How to apply:** режим брать замером (`git ls-tree origin/comms <path>`), родителя — свежим
`git fetch origin comms`; заголовок коммита НЕ начинать с `chore(comms): rebuild derived` —
это гард петли `Comms Derived`, и с ним генератор на свой push не поднимется. Приёмка —
`git show origin/comms:<path> | git hash-object --stdin`. См. [[thin-copy-needs-callee-landed-first]].
