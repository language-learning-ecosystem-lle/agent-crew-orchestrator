---
name: guard2-reddens-from-its-own-review-circle
description: "Пока круг ревью летит, гард 2 красный своим же кругом (`review=IN_PROGRESS`) — кнопка недоступна ПО ФАКТАМ"
metadata: 
  node_type: memory
  type: project
  originSessionId: 01f6793e-5ed5-4926-b6b1-9787fd9a53bc
  modified: 2026-09-08T13:58:01.620Z
---

Джоба ревьюера — обычный чек на голове, поэтому `merge-gate` над летящим кругом печатает
`STOP guard 2 · green checks on the same head: not green: review=IN_PROGRESS`, хотя сам `checks`
на этой голове зелёный отдельным прогоном. Замерено 2026-09-08 на #341 (голова `96ef59fd`, круг
`34234625707`): гард 1 STOP (вердикта ещё нет) и гард 2 STOP одновременно — второй только из-за
круга. То же видел ревьюер на прошлой голове и назвал «ожидаемо на активном PR, не находка».

**Why:** красный гард 2 читается как «CI сломан» и провоцирует лишний замер, перевешивание метки или
попытку кнопки. На деле merge над летящим кругом невозможен ПО ПОСТРОЕНИЮ — оба гарда снимет одно и
то же событие, приезд вердикта.

**How to apply:** подняли роль, а круг на голове ещё `in_progress` (`gh run view <id> --json status`) —
кнопки в этот ход нет; замер двери годится следом, но решает не он. Отчитаться замером, встать
`--parked-on run:<pr>` и передать ход ([[park-goes-after-the-verdict-not-before]],
[[review-circle-verdict-lands-in-minutes]]). Не путать с [[round-reddens-on-the-receipt]] — там
краснеет квитанция при видимом `approve`.
