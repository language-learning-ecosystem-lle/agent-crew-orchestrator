---
name: cut-tag-validity-is-a-line-search
description: "Ложность тега среза проверяется поиском его дерева в ЛИНИИ origin/main, а не сравнением с origin/main:packages/… — main уезжает вперёд тега и даёт ложное расхождение"
metadata: 
  node_type: memory
  type: project
  originSessionId: d5345b76-c726-4d07-8007-f40c20a9c207
  modified: 2026-09-03T13:47:22.635Z
---

Тег среза (`agent-protocol-v*`) годен, если дерево реза встречается у КАКОГО-ТО коммита линии
`origin/main`, а не если он равен `origin/main:packages/agent-protocol` СЕЙЧАС: между резом и
чтением в `main` садятся чужие PR, трогающие пакет, и прямое сравнение краснеет на честном теге.
Замер 2026-09-03: `agent-protocol-v0.2.10^{tree}` = `aa092de7` ≠ `origin/main:packages/agent-protocol`
(`8e50cd42`), но `aa092de7` — ровно `packages/agent-protocol` на влитом `7376418c` (#228), то есть
тег чист; а ложный `v0.2.8` (`4e70d139`) не встречается в линии вовсе. Скан 25 последних коммитов
`main` циклом `git rev-parse <c>:packages/agent-protocol` стоит секунды.

**Why:** прямое сравнение с головой — та самая проверка, что даёт ложный отказ на правильном теге и
тем обесценивает единственный ручной барьер: дверь реза этот класс не ловит (гард линии односторонний,
дом — тред `095-cut-guard-one-sided`).

**How to apply:** приёмка «потребитель не на ложном теге» = четыре чтения его файлов
(`agent-protocol.json` → `protocolVersion`, СОДЕРЖИМОЕ `node_modules/agent-protocol/package.json` →
`version`, пин в `package.json` и `pnpm-workspace.yaml`) плюс поиск дерева реза в линии `main`. Все —
чтения, границу контура ([[reading-a-ref-must-not-write-the-tree]], `062`) не переступают.
Связано: [[statement-of-work-ends-at-the-tag]], [[pinned-blob-rots-in-the-review-circle]].
