---
name: mode-park-is-filtered-by-the-digest-not-by-the-register
description: "Парк-режим (`expects: none`) сводка человеку не адресует, кадр называет отдельным предложением — а реестр пишет имя человека; различие несёт `Parking.asks`, а не новое поле."
metadata: 
  node_type: memory
  type: project
  thread: 155-park-has-no-checkable-ground
  originSessionId: ae12bc2a-9c7e-4aca-ae82-54fa4eb9e28d
  modified: 2026-09-09T21:47:22.686Z
---

Различие «парк ждёт ЧЕЛОВЕКА / парк ждёт СОБЫТИЯ» уже есть в машине — это `Parking.asks`
(`expects` объявляющего письма) и `modeParks` (`thread/index-doc.ts`), заведённые тредом `063`.
Замерено зондом на живых модулях `main` (2026-09-09, два треда, отличающихся ровно полем
`expects`):

- **кадр** (`describeOrder` → `describeFreeze`, `orchestrator/priority.ts`) — различает целым
  предложением: `PARKED as a MODE set by X` против `PARKED behind a decision of X`;
- **сводка человеку** — парк-режим ей НЕ адресуется вовсе: все пять источников строк
  `kind: "parked"` в `notify/notify.ts` стоя́т на `asks` (`freshParked`, `missedParks`,
  `restatedParked`, `remindedParked`, `liftedParked`);
- **реестр** (`INDEX.md`, `parkCell`) — НЕ различает: `john · дата` против `❓ john · дата`.
  Различие держится ОТСУТСТВИЕМ метки, а имя человека стои́т в колонке `parked-on` в обоих.

**Why:** «сводка показывает долг, которого нет» — предположение, которое замер опровергает;
реальная поверхность — реестр, и правка там не требует ни нового поля, ни ключа конфига.

**How to apply:** прежде чем проектировать новую форму основания парка, мерь ПОВЕРХНОСТЬ зондом
из `mktemp -d -p /tmp` (импорт живых модулей, два треда на одном отличии) — нужный факт часто
уже несётся, и не хватает его одной колонке. См. [[park-under-a-round-dies-with-the-round]],
[[missing-park-row-does-not-prove-silence]].
