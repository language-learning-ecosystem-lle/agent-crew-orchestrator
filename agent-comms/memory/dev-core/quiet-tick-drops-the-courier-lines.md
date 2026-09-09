---
name: quiet-tick-drops-the-courier-lines
description: "Тихий такт демона печатал только summary и ронял run.lines — сторожа не видно именно тогда, когда он держит замок"
metadata: 
  node_type: memory
  type: project
  originSessionId: 576c7c3c-9fc0-4545-9b56-892778006da6
  modified: 2026-09-09T18:54:24.366Z
---

`dialCourier` (`cli.ts`, ~`:13255`) печатал `run.lines` только при `kind === "sent"` и при отказе
доставки (в `stderr`). Ветка **`quiet` печатала один `run.summary`** и роняла все строки такта.

**Why:** тихий такт — это такт, чьи сторожа ДЕРЖАТ замки, то есть единственный класс такта, на
котором «пара найдена, письмо удержано, вот почему» и есть правда. Замерено 09.09.2026: восемь
подряд строк `… — nothing to announce` и ни одной о стороже номеров, пока тот обходил восемь пар.

**How to apply:** «в `daemon.log` нет строки сторожа» НЕ доказывает, что сторож молчал, — проверь
сначала, был ли такт `quiet`. Якорь для счёта — `^agent-protocol: daemon — courier: ` (в журнал
попадают транскрипты, см. [[daemon-log-grep-needs-an-anchor]]). Чинится в PR #364 (тред 184);
до его посадки этот перекос в силе. Смежное: [[notify-state-has-no-partial-write]].
