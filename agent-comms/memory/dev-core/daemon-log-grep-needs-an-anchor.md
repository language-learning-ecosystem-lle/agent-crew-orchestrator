---
name: daemon-log-grep-needs-an-anchor
description: "В daemon.log попадают транскрипты сессий, поэтому счёт строк демона без якоря `^agent-protocol: daemon —` завышен."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0f08e97d-385f-4434-a168-cadcd6f8222e
  modified: 2026-09-02T18:26:16.094Z
---

`.orchestrator/daemon.log` несёт не только строки демона, но и ЭХО транскриптов поднятых
сессий — включая команды и вывод, в которых цитируются эти же строки. `grep -c "the dead-man
ping was NOT delivered"` даёт число больше настоящего; считать надо с якорем
`^agent-protocol: daemon — `.

**Why:** на этом уже чуть не построили вывод дважды (curator 2026-08-30, я 2026-09-02); замер,
поданный в тред как факт, обязан быть счётом строк демона, а не строк лога.

**How to apply:** любой счёт по `daemon.log`/`daemon.log.1` — с якорем начала строки. Эпохи
разделены: `daemon.log.1` — предыдущая, маркер эпохи — баннер `circuit watchdog ON` /
`daemon-code.json`. Смежное: [[red-main-checks-may-be-comms-sync]].
