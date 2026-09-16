---
name: park-on-a-pr-needs-a-mover
description: "`--parked-on pr:N` отказывает без `--park-mover`, и парк за ходом СВОЕГО треда замораживает того, кого надо поднять"
metadata: 
  node_type: memory
  type: project
  originSessionId: 711e0561-8ff0-49c3-87e7-be77dfd2eed3
  modified: 2026-09-16T13:29:03.493Z
---

`--parked-on pr:N` без `--park-mover <participant>` — отказ двери по имени: парк ждёт РУКУ на кнопке, а не событие. У `run:N` такого требования нет.

**Why:** отказ формулирует предметную проверку — «a park behind an event that needs THIS thread's own next step is a door locked from the inside» (тред 061). Замерено 16.09 на треде 214: парк на свой же PR #456 заморозил бы curator, чей ход (метка `review` после зелёного) и есть то, чего ждёшь.

**How to apply:** перед `--parked-on` спросить «кого этот парк заморозит». Совпал с `waiting-on` — парк не нужен вовсе: `waiting-on` поднимает сам, а зелёный `checks` по PR рождает письмо. Снимается парк `pr:N` ТОЛЬКО заголовком `merged-pr: N` в почте — см. [[do-not-park-on-a-green-ci-run.md]], [[park-pr-vs-run-choice]].
