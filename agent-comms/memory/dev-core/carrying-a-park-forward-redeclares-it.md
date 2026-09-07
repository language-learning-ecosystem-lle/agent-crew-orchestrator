---
name: carrying-a-park-forward-redeclares-it
description: "`--parked-on <то же значение>` не сохраняет стоячий парк, а объявляет новый: `since`, `question`, `holder` и `park-ground` берутся из письма-переносчика, прежние теряются молча."
metadata: 
  node_type: memory
  type: project
  thread: 155-park-has-no-checkable-ground
  originSessionId: 9da6bd32-bef9-4b78-aab3-44eeba4b1477
  modified: 2026-09-07T18:40:07.491Z
---

`standingParkOf` идёт с конца ленты и останавливается на ПЕРВОМ письме, несущем `parked-on:`
(`thread/thread.ts`). Значит перенос парка вперёд — новое объявление. Замерено пробой 2026-09-07 на
голове `0dca1bb9`: парк 10:00 → честный доклад с тем же `--parked-on` в 12:00 даёт `since 12:00`,
`question` = первая строка ДОКЛАДА, `holder` = `waiting-on` доклада, а `park-ground` пропадает целиком.

**Why:** три из четырёх полей читает курьер к человеку, четвёртое — тик основания. То есть после
честного переноса человеку показывают чужой вопрос и неверный возраст парка, а машинно проверяемое
основание гаснет — при том, что сама дверь `park-seen` советует именно `--parked-on <то же>`.

**How to apply:** переносишь парк — повторяй и его квалификаторы (`--park-ground`, и `--park-mover`
для `pr:`), а не только значение; меришь возраст или вопрос парка — бери их у ПЕРВОГО объявления,
а не у того, что вернул `parkingOf`. И не верь ноте двери о машинном письме («the park is NOT lifted
and NOT touched by it»): она утверждает исход, которого не спрашивала, — `parkingOf` на том же письме
парк снимает, когда письмо кончает ход, на котором парк объявлен. Смотри
[[letter-into-a-standing-park-must-name-it]] и [[missing-park-row-does-not-prove-silence]].
