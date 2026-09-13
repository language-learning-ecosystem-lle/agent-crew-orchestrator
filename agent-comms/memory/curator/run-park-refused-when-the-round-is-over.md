---
name: run-park-refused-when-the-round-is-over
description: "`--parked-on run:N` отказывает, когда все прогоны на голове `completed` — парк «круга, который уже кончился»"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 29ee293e-79d6-42f8-976b-44da149c9bf7
  modified: 2026-09-13T09:50:15.740Z
---

Дверь `new-message` сверяет источник только у парка `run:N`, и отказов у неё ДВА: «на голове нет
ни одного прогона» и отдельно «круг уже кончился» — если ни один прогон на голове не `queued` и не
`in_progress` (README пакета, раздел Commands, тред 032). Проверяется одной командой перед письмом:
`gh api 'repos/<owner>/<repo>/actions/runs?head_sha=<sha>' --jq '.workflow_runs[] | .status'`.

**Why:** после УПАВШЕГО круга инстинкт — «запаркуюсь на run:N и пусть разбудит следующий прогон».
Ждать нечего: лифт парка смотрит только вперёд, а исход уже лежит в ленте ПОЗАДИ парка.

**How to apply:** нечего ждать прогоном и следующее действие механическое и своё — ход передаётся
на себя БЕЗ парка (`--waiting-on curator`, и тогда `--expects none`: дверь отказывает связке
`--expects ack` + `waiting-on curator` + без парка как состоянию без законного исхода). Парк на
человеке тут тоже неверен — он заморозит тред за чужим словом, которого работа не ждёт.
См. [[failed-review-run-reddens-guard2]], [[run-park-under-checks-ends-only-by-ceiling]].
