---
name: self-restart-record-is-single-slot
description: "Запись `.orchestrator/self-restart.json` однослотовая — следующий перезапуск её затирает, и поля непрочитанного письма мерятся журналом"
metadata: 
  node_type: memory
  type: reference
  originSessionId: e222c7d2-4abc-4e44-8c99-317aa4d95a68
  modified: 2026-09-13T17:39:56.466Z
---

`.orchestrator/self-restart.json` держит ТОЛЬКО последний перезапуск: письмо самоперезапуска, поднявшее роль с задержкой (дренаж придерживает пару и отдаёт преемнику — замерено 2 ч между письмом и подъёмом), к моменту чтения уже НЕ имеет своей записи.

Тогда шесть полей мерятся `.orchestrator/daemon.log` ([[field-state-is-read-from-the-daemon-log-file]]): эпизод ремонта даёт `runs <from> …, origin/main on disk is <to> — N commit(s) behind`, `git pull --ff-only — ok: …`, `pnpm install skipped/ok`, `the tree is on <to> — leaving with code 75`; заголовок `=== daemon epoch · <ts> · pid N ===` доказывает подъём преемника, а СЛЕДУЮЩИЙ ремонт называет своё дерево (`across <to>..<next> (the code this process is running`) — это свидетель исполнения вместо мёртвого `/proc` ([[merged-code-is-not-running-code]]).

Время дренажа: у журнала свой штамп `drifting for Nm (since <local TZ>)`, и он на **4–5 с РАНЬШЕ** `drainSince` записи (два события одного такта). Смещение калибруется на перезапуске, у которого живы оба числа, — иначе вычитание письма читается как расхождение.

Второе смещение, у ДРУГОГО поля: `startedAt` в `.orchestrator/daemon-code.json` (и равная ему строка `up since` эпохи) стоит на **~10 с ПОЗЖЕ** реального старта процесса — замерено 13.09 на живой эпохе `050e642a`: `TZ=UTC ps -o lstart -p <pid>` даёт 17:20:20Z против `startedAt` 17:20:30Z. Практическое следствие: зазор «решение о перезапуске → подъём», считанный по письму и `up since`, выходит 21 с, а настоящий — прежние 11–12 с. Прежде чем звать рост зазора изменением, вычесть это смещение ([[reproduce-with-the-tool-that-measured]]).

Письма нет вовсе, если дифф не тронул отпечаток (`packages/<пакет>` + три манифеста): журнал печатает `letter — WITHHELD…` каждый такт, а замок повтора `.orchestrator/self-restart-letters.json` (подпись `<to>\0<at>`) остаётся на прошлом письме — по нему и видно, какое письмо было последним. См. [[self-restart-ack-is-not-asked-twice]].
