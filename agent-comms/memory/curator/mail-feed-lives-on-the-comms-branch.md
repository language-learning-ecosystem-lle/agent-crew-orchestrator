---
name: mail-feed-lives-on-the-comms-branch
description: "Лента почты лежит на ветке origin/comms, и пути в git читаются от чекаута agent-comms"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 387d7766-180d-4d0f-a929-f992ab17d122
  modified: 2026-09-08T10:38:57.894Z
---

Каталоги тредов лежат НЕ в `origin/main`, а на ветке `origin/comms`, под префиксом `agent-comms/`.
Из чекаута `.worktrees/comms/agent-comms` массовое чтение статусов идёт даром и без CLI:

- перечисление: `git ls-tree --name-only origin/comms | grep -E '^[0-9]{3}'` — `ls-tree` применяет
  префикс cwd сам, поэтому имена выходят голыми;
- чтение файла: `git show origin/comms:./<тред>/_meta.md` — точка обязательна, `origin/comms:<тред>/…`
  отвечает `fatal: path 'agent-comms/<тред>/…' exists, but not '<тред>/…'`.

Так снимается `status:` всех тредов одной командой — там, где `cli thread show` стоил бы прогона на
каждый. Полезно, когда критерий надо мерить ПЕРЕЧИСЛЕНИЕМ, а не образцом
([[field-sample-criterion-yields-to-enumeration]], [[reported-instance-is-a-sample]]).
