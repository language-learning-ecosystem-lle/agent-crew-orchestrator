---
name: daemon-log-dates-its-own-code
description: "Момент, когда демон встал на новый код, читается строкой `daemon — code: <sha> … up since <ts>` в daemon.log — а не временем мержа и не mtime чекаута."
metadata: 
  node_type: memory
  type: reference
  originSessionId: f8ff61d8-cdad-4b67-ad84-da016ad57928
  modified: 2026-09-09T21:42:04.641Z
---

Полевая приёмка «дошёл ли контур до влитого кода» датируется **строкой самого журнала**, а не
временем мержа: каждый эпох демона печатает

```
agent-protocol: daemon — code: <sha12> loaded from <path>, up since <ISO>
```

и она называет ИМЕННО ту ревизию, которую исполняет процесс. Рядом лежит цепочка перехода:
`daemon — SELF-RESTART: the loaded code is behind <sha> …` → `… the tree is on <sha> — leaving with
code 75`, и следующий `=== daemon epoch ===` уже несёт новый `code:`.

Отсюда практическое: **момент T0 полевого окна** — это `up since` первого эпоха, чей `<sha>`
содержит проверяемый коммит (проверять `git merge-base --is-ancestor <коммит> <sha>`, а не глазом:
между мержем и подъёмом успевают сесть ещё коммиты, и все они тоже годятся).

Мерить окно надо по ОБОИМ файлам — `daemon.log.1` (ротация) и `daemon.log`; склейка непрерывна, конец
одного и начало другого совпадают с моментом ротации.

Счёт тактов в окне — якорно (`[[daemon-log-grep-needs-an-anchor]]`): `^agent-protocol: queue 1/`
даёт число тактов, и его стоит подтвердить вторым независимым якорем той же кратности
(`^agent-protocol: daemon — courier: mail — `). Неякорный греп считает СВОИ ЖЕ команды: транскрипт
живой сессии едет в тот же файл, и строка `command=grep … 'the turn was passed to curator'`
засчитывается как событие, которого не было.

См. также [[log-line-text-proves-which-binary-printed-it]] — когда строки `code:` в окне нет
(журнал обрезан), ревизию доказывает подстрока, введённая коммитом.
