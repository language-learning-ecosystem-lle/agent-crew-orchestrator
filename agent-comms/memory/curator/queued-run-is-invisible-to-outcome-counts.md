---
name: queued-run-is-invisible-to-outcome-counts
description: "Прогон может застрять `queued` навсегда, и счёт по `conclusion` его не видит — перечень исходов воркфлоу четырёхчастный"
metadata: 
  node_type: memory
  type: reference
  originSessionId: b65d2ecc-cfcf-4a8c-8099-ca810db3d8e5
  modified: 2026-09-13T10:45:47.011Z
---

Счёт исходов воркфлоу по `conclusion` (`skipped`+`success`+`failure`) НЕ полон: прогон со
`status: queued` имеет `conclusion: null`, в `gh run list` выглядит как «ещё идёт» и не попадает ни в
одну кучу. Застрять он может навсегда: замерено 2026-09-13 — два прогона `Notifier Watch`
(`34748694408`, `34748763680`) стояли `queued` 1 ч 43 мин, джобов ноль, ни один шаг не исполнялся,
при том что платформа уже поехала и 40 следующих прогонов отработали за секунды.

**Why:** «писем об отказе нет» и «воркфлоу отработал» доказываются перечнем исходов, а перечень с
дыркой врёт в сторону «всё нормально» — красноты о `queued` нет нигде.

**How to apply:** мерить группировкой по `\(.status)/\(.conclusion)` на окне в сотни прогонов
(`gh run list --workflow '<имя>' --limit 400 --json status,conclusion`), а не по одному `conclusion`;
отдельно спрашивать `select(.status!="completed")`. Тем же перечислением снимается и размер класса —
[[field-sample-criterion-yields-to-enumeration]], [[reported-instance-is-a-sample]]. Родственное про
незавершённость у чеков — [[check-state-is-read-from-bucket]]; про усечение окна —
[[run-list-truncates-to-the-newest-n]].
