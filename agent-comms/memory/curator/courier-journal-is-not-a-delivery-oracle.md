---
name: courier-journal-is-not-a-delivery-oracle
description: "Строка курьера в daemon.log может объявлять «звонить не о чем» ровно о той паре, о которой он в это же время шлёт письма — доставка меряется приёмником"
metadata: 
  node_type: memory
  type: project
  originSessionId: d43e132e-37b0-40e3-8b51-deb34b8e6504
  modified: 2026-09-09T17:01:50.042Z
---

Журнал курьера (`.orchestrator/daemon.log(+.1)`) — свидетельство о том, что тик СКАЗАЛ, а не о том, что он ДОСТАВИЛ, и эти два расходятся.

**Замер 2026-09-09 (тред `159-thread-number-has-no-door`, сторож дублей номеров):** 41 строка
`number-collision — N number(s) …, every half closed: nothing to ring about` (13 из них включают пару `180`), греп на звонок — **0 совпадений в обоих файлах журнала**. В приёмнике `181-thread-number-collision` за то же время лежит **15 писем** об этой самой паре, обе половины которой `status: open` в ленте.

**Why:** молчание в журнале читается как «сторож не сработал» и закрывает проверку раньше факта; здесь оно бы спрятало и полевой дефект (замок повтора), и ложную строку самого журнала.

**How to apply:** срабатывание/молчание смотрителя меряй ПРИЁМНИКОМ — счётом файлов в `agent-comms/<стоячий адрес>/messages/` и статусами предмета в `_meta.md`, — а журнал бери только как второй, независимый голос: расхождение двух само по себе находка. См. [[merged-code-is-not-running-code]], [[delta-gated-watcher-is-silent-on-a-clean-tree]], [[field-state-is-read-from-the-daemon-log-file]].
