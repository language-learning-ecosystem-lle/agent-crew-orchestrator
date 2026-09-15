---
name: pr-state-fork-must-be-measured-at-the-fork
description: "Замер `gh pr view --json state` — снимок на момент вызова; развилка такта «MERGED/OPEN» меряется ПЕРЕД самой развилкой, и `git log origin/main` называет посадку раньше"
metadata: 
  node_type: memory
  type: project
  originSessionId: edd661cb-4891-4346-9e93-d3356d305d02
  modified: 2026-09-15T11:45:38.016Z
---

Постановка, чья развилка стои́т на состоянии ЧУЖОГО PR («`MERGED` → веди оба, `OPEN` → веди один и
передай ход»), требует замера **перед самой развилкой**, а не «в начале такта». Замерено 15.09.2026
на #448 в треде `200-run-census-drops-queued`: `gh pr view 448 --json state` в 11:33:37Z → `OPEN`;
он же в 11:36:00Z → `MERGED`, `mergedAt 2026-09-15T11:34:56Z`. **79 секунд** между двумя ответами, и
между ними такт уже успел выбрать «бедную» ветку постановки.

**Why:** ответ `gh` — снимок на момент вызова, а не подписка. Приняв его за состояние мира на весь
такт, роль исполняет половину заказанного и честно докладывает «по замеру было `OPEN`» — работа
недоделана, а отчёт при этом верен, так что поймать это некому.

**How to apply:** перед развилкой перемерять `gh pr view <N> --json state,mergedAt`. Второй и более
дешёвый оракул — `git fetch origin main && git log --oneline -3 origin/main`: **номер PR в теме
squash-коммита говорит о посадке раньше, чем это устаивается в ответе про сам PR** (именно так
расхождение и нашлось — ветка заводилась от свежего `origin/main`, и в нём уже стоял `(#448)`).
Связано: [[origin-main-can-advance-mid-tick]], [[stale-pr-may-be-superseded]],
[[branch-may-be-ahead-of-thread]], [[order-may-be-executed-by-another-thread]].
