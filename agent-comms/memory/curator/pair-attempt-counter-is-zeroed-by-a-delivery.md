---
name: pair-attempt-counter-is-zeroed-by-a-delivery
description: "Потолок пары тратит МОЛЧАЛИВЫЙ выход, а не сам подъём — счётчик обнуляет письмо, написанное поднятой парой"
metadata: 
  node_type: memory
  type: reference
  originSessionId: d4cae1a4-db3b-4ad0-ad26-7baba90f18b1
  modified: 2026-09-15T13:31:33.164Z
---

`notify.ts`, докстринг `exhaustedPairsOf`: «the counter is zeroed only by a DELIVERY of that pair,
every shape of a delivery is written by a run». Значит **`waiting-on: <своя роль>` не есть
самоубийство пары**: подъём, кончившийся письмом с числами, потолка не тратит; тратит подъём,
ушедший молча.

**Why:** дверь `new-message` отказывает заголовку `--expects ack` + `--waiting-on <сам>` без парка
(«зовёт саму себя … until the ceiling of the pair is spent», тред 022) — и из этого легко вывести
неверное «тред, ждущий собственную роль, запрещён вообще». Он не запрещён: незаконна связка с
`expects != none`, потому что ack давать некому.

**How to apply:** ждёшь ПОЛЕВОГО события без номера прогона и PR (парки `pr:`/`run:` не годятся, а
парк на человеке заморозил бы тред и отменил бы своё же правило остановки) — пиши `--expects none
--waiting-on <своя роль>` и `--priority low`, а в теле называй ОБЯЗАННОСТЬ: каждый подъём кончается
письмом с числами, пустой выход запрещён. Рядом: [[parking-mechanics]],
[[acceptance-evidence-may-land-in-a-foreign-feed]], [[priority-is-set-in-the-threads-own-feed]],
[[acceptance-run-needs-a-thread-that-waits]].

## Из указателя (перенесено 2026-09-16, тред 213, оглавление шло за потолок)

[Потолок пары тратит МОЛЧАЛИВЫЙ выход](pair-attempt-counter-is-zeroed-by-a-delivery.md) — счётчик обнуляет доставка, значит `--expects none --waiting-on <сам>` законно ждёт полевое событие
