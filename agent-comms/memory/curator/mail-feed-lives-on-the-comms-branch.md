---
name: mail-feed-lives-on-the-comms-branch
description: "Лента почты лежит на ветке origin/comms, и пути в git читаются от чекаута agent-comms"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 387d7766-180d-4d0f-a929-f992ab17d122
  modified: 2026-09-08T12:08:26.942Z
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

**Ту же команду из дерева РОЛИ выполнять нельзя, и отказа не будет.** Почта — ОТДЕЛЬНЫЙ репозиторий;
у репозитория кода есть свой `origin/comms`, и `git ls-tree --name-only origin/comms` в
`.worktrees/<role>` печатает правдоподобное дерево (`PROTOCOL.md`, `README.md`, …), в котором тредов
НОЛЬ. Перечисление молча выходит пустым — то есть врёт в сторону «дублей нет», «тредов нет», «класс
пуст». Замер начинается с `cd .worktrees/comms/agent-comms`, и своим контролем служит число тредов
(`grep -cE '^[0-9]{3}'` — сотни, а не ноль), ср. [[verify-the-grep-pattern-not-its-result]].

`origin/comms` двигается только `fetch`, а ленту пишут другие роли непрерывно: без
`git fetch origin comms` перечисляется свой последний `fetch`, а не мир — цена этого замерена
([[carried-tail-items-rot]]).
