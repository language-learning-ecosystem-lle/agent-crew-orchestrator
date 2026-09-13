---
name: base-cost-only-measures-since-the-last-schema-bump
description: "scripts/base-cost.mjs падает ProtocolVersionError на любом такте, чей конфиг старше текущей схемы пакета — мерить можно только окно с последнего бампа"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 92689424-a2c1-4ba2-a186-2e790187fa52
  modified: 2026-09-13T08:45:38.907Z
---

`node --import tsx scripts/base-cost.mjs --since <дата>` восстанавливает конфиг такта через
`loadProtocolConfig`, а та требует `protocolVersion` РОВНО текущей версии пакета. Любой такт, чей
ближайший коммит `agent-protocol.json` объявляет старую версию, роняет прогон целиком:
`ProtocolVersionError … declares 25, the package writes 27` (`schema/version.ts:136` ←
`config/load.ts:218` ← `base-cost.mjs:240 configAt`).

Следствие, из-за которого прибор бесполезен ровно тогда, когда нужен: **каждый бамп схемы обнуляет
всю его историю**. Окно после последнего бампа приходится брать коротким, а на коротком МНК вырождается —
`подгонка не сошлась — система вырождена`. Замерено 2026-09-13: `--since 2026-09-07` падает
(бампы v26 `f9562234c` 07.09 17:35Z, v27 `2f17b9cd1` 09.09 14:33Z), `--since 2026-09-12` доходит до
подгонки и вырождается. Оба исхода — НЕ число.

Пока не починен: длину карточки и её дельту меряй git'ом (`git show <sha>:<путь> | wc -m` по серии
коммитов), а деньги считай арифметикой от опубликованного γ = 0,6566 токена на знак — и называй это
производным числом, а не показанием прибора. См. [[reproduce-with-the-tool-that-measured]],
[[merged-fix-leaves-a-stale-doc-instrument]], [[schema-version-bump-is-johns-button]].
