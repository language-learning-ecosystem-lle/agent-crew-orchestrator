---
name: worktree-lock-and-lease-fold-are-two-instants
description: "Живую пару мерить фолдом аренд журнала, а не строкой лока рабочего места в `orchestrator status`"
metadata: 
  node_type: memory
  type: project
  originSessionId: d6074103-ac97-4e12-b7f3-0afae5437bdc
  modified: 2026-09-13T11:03:15.894Z
---

`orchestrator status` печатает у рабочего места строку `locked by a live run: '… since T'`.
Это ЛОК дерева, снятый в момент печати; кто жив ПО ПРОТОКОЛУ — говорит фолд аренд
(`foldLeases` + `isLeaseAlive`, то же, чем считает клапан и планировщик).

Полевой случай 2026-09-13: `status` в `10:48Z` показал `curator×182` под локом «since
10:45:10Z», а её `lease-released` стои́т в журнале `10:49:43Z` — к моим замерам в `10:50Z`
живых пар было две, не три, и «потолок ящика не сработал» оказался НЕ дефектом.

**Why:** разойтись эти два чтения могут на минуты, и вывод «дверь не спросила потолок»
строится ровно на этой разнице. Цена ошибки — ложный дефект в докладе.

**How to apply:** заподозрил, что дверь не досчитала живых, — сперва посчитай сам:
`foldLeases(parseJournal(journal), now, maxAttempts)` + `isLeaseAlive`, и сверь с меткой
времени `lease-released` в `.orchestrator/journal.jsonl`. Только потом называй дефект.
Сухой замер потолка — [[dry-run-is-a-free-oracle-on-the-ceilings]].
