---
name: suite-count-differs-between-workspace-and-ci
description: "Счёт проверок сюиты: рабочее место против раннера — ровно 2 (два ctx.skip без бинаря codex); слитое дерево против прогона PR — формула +2+новые тесты уехавшей базы"
metadata: 
  node_type: memory
  type: project
  originSessionId: aebc67af-30f5-489d-b786-1cc7f148af4a
  modified: 2026-09-12T16:52:18.945Z
---

Полная сюита `agent-protocol` печатает `4135 passed (4135)` в рабочем месте роли и
`4133 passed | 2 skipped (4135)` на раннере: два условных `ctx.skip(...)` в
`orchestrator/sandbox-loader.process.test.ts` пропускаются, когда на машине нет бинаря `codex`
(замерено 2026-09-12, тред `180-selfheal-leaves-the-workspaces-behind`, PR #372, прогон
`34700856284`).

**Why:** расхождение выглядит как «доклад врёт про зелёное», а это свойство машины, не диффа —
общее число (в скобках) сходится, расходится только `passed`/`skipped`.

**How to apply:** принимать по числу CI-прогона, а не рабочего места, когда зелёный `checks` на
голове уже есть; «N passed» из рабочего места против «N-2 passed | 2 skipped» на раннере —
не находка. См. [[green-is-only-the-runners-command]], [[vendor-sandbox-measures-for-free]],
[[reproduce-with-the-tool-that-measured]].

**Приёмка на СЛИТОМ дереве сходится с CI формулой, и её надо считать, а не глядеть**
(замерено 2026-09-12, PR #374, тот же тред): `passed` клона = `passed` прогона PR **+ 2**
(те же два `ctx.skip` на ящике ПРОГНАНЫ — бинарь `codex` тут есть) **+ новые тесты коммитов,
уехавших в базу после старта зачтённого чека**. Для #374: `4136 + 2 + 14 = 4152 passed (4152)`,
0 skipped, 243 с на `--shared`-клоне дерева `merge-tree`. Без этой арифметики «4152 против 4138»
читается как расхождение доклада. Клон С `.git` держит зелёными и те 4 теста, что краснеют на
склеенной копии ([[gitless-tree-copy-reddens-four-tests]]); форма клона —
[[acceptance-on-the-merged-tree-is-cheap]], нота базы — [[base-move-note-answered-by-measure]].
