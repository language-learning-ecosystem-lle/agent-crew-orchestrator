---
name: stop-flag-without-self-restart-lines-is-a-live-hand
description: "Стоп-флаг без строк SELF-RESTART — это живая рука в ps; если живая сессия одна, ждут ИМЕННО тебя, и такт сворачивается досрочно"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9c45186f-f05d-45b5-9054-ac5d6b18fe65
  modified: 2026-09-17T16:32:16.033Z
---

Демон печатает `the stop flag: waiting for 1 live session(s) — <пара>`, а `.orchestrator/stop`
появляется заново уже ПОСЛЕ снятия его самоперезапуском. Кто его поставил, гадать не надо:

- `stat -c '%y' .orchestrator/stop` — минута постановки;
- **строки `SELF-RESTART:` перед ней в `daemon.log`** — есть значит ящик, НЕТ значит рука
  (тот же прибор, что и у [[chain-break-may-be-a-hand-not-a-lost-letter]]);
- `ps -eo pid,ppid,lstart,cmd` — рука видна ЖИВЫМ процессом `cli.ts orchestrator restart --pull`
  (замерено 2026-09-17: pid 2298429 под `sudo -u aco-hetzner -i`, предок — ssh-сессия `lle`,
  `who -u` даёт её pts и минуту).

**Что это меняет в ходе:** демон уходит на первом тике после закрытия ПОСЛЕДНЕЙ живой сессии. Если
живая сессия одна и она твоя — человек стоит у стопа и ждёт лично тебя. Такт в этом положении
сворачивается досрочно: добирать окно значит держать чужую руку. Дрейф при этом может быть нулевым
(`origin/main` = загруженный код) — рука перезапускает ПРОЦЕСС, а не догоняет код, и письма от такой
эпохи не будет вовсе (см. [[daemon-epoch-is-one-process]]).
