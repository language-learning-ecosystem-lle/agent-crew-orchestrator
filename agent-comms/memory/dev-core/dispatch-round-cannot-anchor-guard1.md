---
name: dispatch-round-cannot-anchor-guard1
description: "Круг ревью, поднятый `workflow_dispatch`, гард 1 не якорит никогда — фильтр требует `event === \"pull_request\"`, и такой круг висит на голове БАЗОВОЙ ветки"
metadata: 
  node_type: memory
  type: reference
  originSessionId: ebbc1183-6b59-47f1-9fa5-9fdd02a3d6d4
  modified: 2026-09-14T16:59:20.454Z
---

`reviewRunAnchor` (`packages/agent-protocol/src/merge/gate.ts`, замер 14.09 — около строк 940–952)
берёт в якоря только круги, у которых сразу всё: `run.name === <--review-workflow>`,
`run.headSha === <голова PR>`, **`run.event === "pull_request"`**, `status === "completed"` и
`conclusion === "success"`. Комментарий рядом называет причину исключения dispatch прямо: такой
круг висит на голове базовой ветки и несёт ЕЁ `head_sha`, то есть отсеивается обеими половинами
сразу.

**Why:** `workflow_dispatch` выглядит дешёвым обходом, когда метку вешать не хочется (окно лимита,
жаль сжечь круг, хочется «просто проверить, отвечает ли учётка»). Он не обход: вердикт приедет, а
гард 1 останется `orphan`, и метку всё равно придётся вешать — то есть заплачено будет ДВАЖДЫ за
одно конечное состояние. Как ЗОНД состояния учётки он тоже плох: тратит круг той же дефицитной
квоты, ради которой зонд и затевался.

**How to apply:** нужен якорь — нужна метка `review` (событие `labeled`), других дверей нет. Нужно
знать, отвечает ли основная учётка, — читать чужие круги списком, а не поднимать свой
([[zero-review-rounds-is-no-observation-not-a-down-account]]). Связано:
[[merge-gate-guard1-needs-review-workflow-name]], [[migrated-review-round-is-always-red]],
[[label-survives-force-push-and-mutes-the-lift]].
