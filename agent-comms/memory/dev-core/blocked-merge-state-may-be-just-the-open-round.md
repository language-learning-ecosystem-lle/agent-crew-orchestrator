---
name: blocked-merge-state-may-be-just-the-open-round
description: "mergeStateStatus BLOCKED при MERGEABLE — часто идущий круг ревью, а не разошедшаяся база; перебазировка тут убила бы вердикт."
metadata: 
  node_type: memory
  type: project
  originSessionId: 069e4607-0d20-4160-a04b-99f72627d4ab
  modified: 2026-09-05T14:33:08.869Z
---

`mergeable=MERGEABLE` + `mergeStateStatus=BLOCKED` на голове с меткой `review` означает, как правило,
что круг ревью на этой голове ещё НЕ закрыт — недостающая обязательная проверка `review`. Когда круг
кончается зелёным, статус сам становится `CLEAN` без единой правки дерева (#280: `BLOCKED` в 14:20Z
при `review=IN_PROGRESS` → `CLEAN` в 14:32Z, голова та же `55a96f43`).

**Why:** `BLOCKED` читается как «что-то не так с базой» и провоцирует ребейз. Ребейз сдвинет голову,
а круг поднимает СОБЫТИЕ навешивания метки — вердикт окажется о дереве, которого больше нет, и
порядок пойдёт заново: зелёный `checks` → метку снять и повесить → новый круг. Цена ложного диагноза
здесь — целый круг ревью.

**How to apply:** разводить два поля, а не читать одно. Базу судит `mergeable`
(`CONFLICTING` → ребейз, см. [[green-letter-does-not-mean-still-mergeable]]); `mergeStateStatus`
судит набор обязательных проверок. `BLOCKED` при `MERGEABLE` — сперва посмотреть `gh pr checks <N>`:
есть `review` в `pending`/идущий прогон `Claude PR Review` на этой голове — блок ожидаемый, ждать, не
чинить. Тот же зазор объясняет, почему ревьюер и автор получают РАЗНЫЕ строки одной двери на одной
голове: замер внутри круга даёт `STOP` гардам 1 и 2, замер после — `ok`
([[merge-gate-guard2-reports-the-review-round]], [[merge-gate-guard1-needs-review-workflow-name]]).
