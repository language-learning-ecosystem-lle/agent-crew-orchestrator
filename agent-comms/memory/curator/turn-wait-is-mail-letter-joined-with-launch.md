---
name: turn-wait-is-mail-letter-joined-with-launch
description: "ожидание хода меряется письмом `waiting-on:` из почты против `launch` в журнале ящика; `handoff-detected` началом ожидания НЕ является"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3ee5cdff-bb40-44b3-aaf9-d293dbc9f291
  modified: 2026-09-13T11:27:27.648Z
---

Замер «сколько ход ждёт роль» собирается из двух источников: `git grep -m1 "^waiting-on:" origin/comms -- '*.md'` из почтового чекаута (путь файла даёт тред и штамп, строка — роль) против событий `{"kind":"launch"}` в `.orchestrator/journal.jsonl`; ожидание = `launch.ts − ts первого непотреблённого письма` этой пары. Событие `handoff-detected` в журнале для этого НЕ годится: оно есть лишь у 1019 подъёмов из 1736 и рождается по другому поводу — наивный join по нему даёт n=0.

**Why:** john держит видимым размен «круги ревью против ожидания», и прибора под него в пакете нет — считается руками этой парой источников. Вторая половина (круги) — `gh run list --workflow 'Claude PR Review'`, только `event=pull_request`, против `gh pr list --state merged`; обе усекаются молча к новейшим N ([[run-list-truncates-to-the-newest-n]]).

**How to apply:** сырую медиану публиковать нельзя одну: парк и замёрзший тред считаются «ожиданием» сутками и переворачивают знак (13.09: сырые 14.8 → 19.3 мин против очищенных от >6 ч 11.4 → 8.8 мин). Печатать ОБЕ колонки и долю ожиданий длиннее порога, называя порог своей рукой. См. [[tick-cost-is-the-queue-not-prose]], [[parks-are-enumerated-by-headers]].
