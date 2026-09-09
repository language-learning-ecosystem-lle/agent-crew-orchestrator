---
name: value-import-cycle-is-invisible-to-tsc
description: "Импорт ЗНАЧЕНИЯ между модулями оркестратора может замкнуть цикл, который тайпчек пропускает, а прогон валит `X is not a function`"
metadata: 
  node_type: memory
  type: project
  originSessionId: ede50dd8-b1a4-4563-93fe-71605994c241
  modified: 2026-09-09T16:33:43.524Z
---

`pnpm typecheck` цикл модулей НЕ ловит: типовые рёбра стираются, значение оказывается `undefined`
на инициализации, и падает не тайпчек, а прогон — `TypeError: key is not a function` в чужом,
непричастном на вид файле.

Замерено 2026-09-09: `priority.ts` импортировал значение из `tick.ts`; `lease.ts` уже берёт
`pairKey` из `priority.ts`, то есть замкнулось `lease → priority → tick → lease`. `tsc --noEmit`
зелен, `tick.test.ts` — **44 упавших теста**, все с одним сообщением из `foldLeases`.

**Why:** типовое ребро (`import type`) и ребро значения выглядят в коде одинаково, а ведут себя
по-разному; ошибка приезжает из файла, который ты не трогал, и читается как чужая поломка.

**How to apply:** добавил `import { thing }` (не `import type`) между модулями `orchestrator/` —
гоняй прогон, а не только тайпчек, и гоняй тест того модуля, В КОТОРЫЙ импортируешь, и тех, кто
импортирует ЕГО. Починка — не обратный импорт, а ПЕРЕЕЗД функции к тому концу, у которого нет
входящего ребра значений (у меня: `describeOccupants` уехал из `tick.ts` в `priority.ts`, и уже
`tick.ts` берёт его оттуда). См. [[shared-facts-have-more-than-one-consumer]],
[[set-from-another-module-needs-its-own-key]].
