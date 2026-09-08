---
name: schema-version-bump-is-johns-button
description: Бамп protocolVersion обязан везти agent-protocol.json тем же диффом — значит ЛЮБОЙ PR с новым полем конфига упирается в гард 4 и едет к john
metadata: 
  node_type: memory
  type: reference
  originSessionId: 93a44166-af5d-4549-a5cd-aef3a0544886
  modified: 2026-09-08T19:19:18.909Z
---

Новое поле конфига требует бампа `protocolVersion`, а бамп по правилу САМОГО ПАКЕТА обязан ехать
вместе с правкой `agent-protocol.json` в ОДНОМ PR: `packages/agent-protocol/src/schema/version.ts`,
комментарий над `CURRENT_PROTOCOL_VERSION`, дословно — «with the `protocolVersion` of the config in
the same PR — otherwise the circuit halts on its own repository». `agent-protocol.json` — док власти,
значит **гард 4 STOP, и merge такого PR — кнопка john ВСЕГДА**, как бы аккуратно ни были разведены
числа. Замерено 2026-09-08, тред 177, #348 (v27): дифф конфига — ровно одна строка `26 → 27`,
прецедент той же формы — #322 (v26).

**Why:** это не отступление исполнителя и не смешение предметов, а механика — разделить «код+схема»
и «конфиг» по двум PR НЕЛЬЗЯ: пакет ветки с `CURRENT_PROTOCOL_VERSION = N` против конфига на `N−1`
останавливает контур на его же репозитории, и до посадки такого PR любая команда пакета с ветки
против `origin/main` отказывает версионной дверью — платит КАЖДЫЙ следующий такт треда.

**How to apply:** увидев в постановке «код+схема+миграция мержу я, конфиг — вторым PR», сразу считать
бамп исключением из этой границы и планировать кнопку john; проверять при этом, что в конфиг
уехала ТОЛЬКО строка версии (числа/значения нового ключа — уже второй PR и второе решение). Гарды
1–2 при этом стоят как стояли: PR без вердикта ревьюера к john не везётся. Отличать от
[[version-bump-ascends-to-johns-acceptance]] — та про `version` ПАКЕТА и про гард 3, эта про
`protocolVersion` СХЕМЫ и про гард 4. См. [[card-prose-rides-the-config-pr]],
[[decision-may-presuppose-a-missing-mechanism]].
