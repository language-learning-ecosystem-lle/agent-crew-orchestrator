---
name: ceiling-refusal-line-is-a-self-defeating-acceptance
description: "Поднятый потолок нельзя принимать строкой отказа `N of M pair(s) allowed on one box` — она печатается ТОЛЬКО когда мест нет"
metadata: 
  node_type: memory
  type: project
  originSessionId: 90b61e33-2524-4865-b6bf-0fbf769cc6b3
  modified: 2026-09-16T13:16:45.688Z
---

`describeSkip` печатает `the ceiling of this BOX is full — N of M pair(s) allowed on one box`
(`orchestrator/tick.ts:898`) только на ветке `box-busy` (`tick.ts:653`). Подняв потолок, ровно и
перестаёшь упирать ящик в конфиг: замерено 2026-09-16 (тред 211, 3 → 5) — после merge в
`daemon.log` и `daemon.log.1` **ноль** таких строк, хотя до него их 2026 штук с `3 of 3`.

**Why:** отрицательная строка есть доказательство, только пока потолок МЕШАЕТ; заказывать её как
приёмку подъёма — заказывать доказательство, которое сама правка и уничтожает.

**How to apply:** новый потолок принимается положительно, тремя дешёвыми замерами:
- `orchestrator status --ref origin/main --instance <box>` (те же флаги, что в
  `.orchestrator/daemon.pid.args`) — строка `parallelism: N of M place(s) live`;
- `daemon.log`: `the plan of this tick: K launches` при `K > старый потолок` — план на K подъёмов
  под старым числом невозможен, `occupied` пополняется каждой запланированной парой того же такта
  (`tick.ts:681`), а проверка ящика стои́т перед ней;
- `.orchestrator/journal.jsonl`: K перекрывающихся `lease-acquired` до первого `lease-released`.

И сначала — [[daemon-reads-parallelism-once-at-startup]]: без рестарта мерить нечего.
