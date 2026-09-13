---
name: pr-open-needs-ref-and-repo-is-a-path
description: "У `pr open` обязателен `--ref`, а `--repo` — это ПУТЬ к чекауту, не слаг `owner/name`."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3f42be6d-6cd5-4c9f-a351-1e6480587e20
  modified: 2026-09-13T14:04:14.265Z
---

`pnpm protocol pr open` (и `cli.ts pr open`) требует `--ref <ref>` — без него отказ по имени, и
никакой PR не создаётся. Рабочая форма из дерева роли:

```
pr open --ref origin/main --title <t> --body-file <p> --head <branch> --base main --write
```

`--repo` здесь — **путь к чекауту**, а не слаг `owner/name`: передашь `language-learning-.../aco`
— команда пойдёт искать каталог. Репозиторий команда берёт из чекаута сама, так что `--repo` в
обычном случае не нужен вовсе.

Без `--write` ничего не создаётся: тело судится дверью и печатается точная строка `gh pr create`.
Заголовок тела — [[pr-open-body-header-is-two-first-lines]].
