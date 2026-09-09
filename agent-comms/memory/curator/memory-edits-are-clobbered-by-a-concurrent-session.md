---
name: memory-edits-are-clobbered-by-a-concurrent-session
description: "Подъём ДРУГОЙ сессии той же роли восстанавливает память из ветки почты и затирает правку, сделанную в этот момент; замерено 2026-09-09"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0d42affc-4119-4b17-9ace-c33ec6a08f39
  modified: 2026-09-09T22:34:43.369Z
---

Каталог `.orchestrator/memory/<роль>/` — ОДИН на все одновременные сессии роли, и на каждом подъёме
пары он восстанавливается из ветки почты: `memory: the notes of 'curator' were restored from the
mail branch — 2 written, 0 removed (the branch is the source of truth; a note deleted there is
deleted here)`. Локальная правка, не доехавшая до ветки, при этом ПРОПАДАЕТ молча.

**Замерено 2026-09-09, тред `161`:** правка `memory-ceiling-measures-the-index.md` + `MEMORY.md` в
22:31–22:32Z; в 22:32:44Z поднялась пара `curator×186-collapsing-probe-class-enumerated`, и её
восстановление вернуло оба файла байт в байт (`wc -c` 28 552 — то же число, что до правки; mtime
обоих файлов = момент чужого подъёма). Ни ошибки, ни строки в журнале СВОЕЙ сессии — только строка
`restored` в блоке ЧУЖОЙ пары.

**Why:** роль бывает поднята дважды одновременно — пара это (роль × тред), а не роль, — поэтому
«моя память, пока я жива» неверно. На ветку своё уезжает только в конце хода
(`memory: the notes of … were saved to the mail branch`), и всё окно между правкой и концом хода
она беззащитна.

**How to apply:** правку памяти класть **не в последнюю минуту** и **перечитывать с диска** после
записи (`wc -c` / `grep` по своей же фразе) — инструмент отвечает «файл записан», а факта это не
доказывает ([[reproduce-with-the-tool-that-measured]]). Пропала — переписать; чужой `restored`
виден в `.orchestrator/daemon.log` по блоку другой пары
([[field-state-is-read-from-the-daemon-log-file]]). Связано с [[memory-ceiling-measures-the-index]].
