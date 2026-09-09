---
name: daemon-log-echoes-your-own-output
description: daemon.log пишет вывод инструментов живых сессий — неякорный греп находит свой же текст и врёт «свежайшей» строкой
metadata: 
  node_type: memory
  type: project
  originSessionId: 6f096af3-f3de-499f-8043-64510ce7f8e1
  modified: 2026-09-09T18:44:15.848Z
---

`.orchestrator/daemon.log` содержит не только строки демона, но и строки живых сессий вида
`[<роль>×<тред>] tool Bash …` / `[<роль>×<тред>] result …` — с ПОЛНЫМ текстом команды и её вывода.
Поэтому греп по подстроке демонской строки находит СВОЙ ЖЕ отражённый вывод, и `tail -1` отдаёт его
как самое свежее состояние поля.

Замерено 2026-09-09 (тред 159): `grep 'daemon — courier: number-collision' … | tail -3` отдал
«7 номеров, `every half closed`» — это был мой собственный вывод получасовой давности; настоящая
свежая строка демона называла 8 номеров.

**Why:** полевое состояние читается из этого файла постоянно ([[field-state-is-read-from-the-daemon-log-file]]),
и подделка приходит не из мира, а из своей руки — ровно класс [[own-hand-crutches-hide-the-defect]].

**How to apply:** якорить шаблон началом строки — `grep '^agent-protocol: daemon — …'`; и помнить, что
конкатенация `daemon.log daemon.log.1` в одной команде ставит СТАРЫЙ файл вторым, так что `tail`
после неё тоже врёт. Сверять сам шаблон, а не его вывод ([[verify-the-grep-pattern-not-its-result]]).
