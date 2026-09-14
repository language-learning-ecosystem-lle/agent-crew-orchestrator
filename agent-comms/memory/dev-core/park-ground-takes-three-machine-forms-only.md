---
name: park-ground-takes-three-machine-forms-only
description: "--park-ground не свободный текст: три машинных формы, иначе дверь отказывает и письмо НЕ уходит"
metadata: 
  node_type: memory
  type: reference
  originSessionId: c6307276-715d-45bb-bda1-a8e5a8627b7d
  modified: 2026-09-14T09:35:13.279Z
---

`--parked-on run:N` + `--park-ground "checks идёт на голове SHA"` = ОТКАЗ двери, письмо не отправлено.
Поле читает ящик, а не человек, и знает ровно три формы: `frozen:<role>×<thread>`,
`no-delivers-since:<thread>`, `until-pr-merged:<n>`.

**Почему:** поле заведено, чтобы ящик МОГ спросить условие парка; непрочитываемая проза — это
проверка, которая никогда не исполнится (тред 155).

**Как применять:** парк на прогон/решение человека ground'а не требует вовсе — просто не писать поле.
Замерено 14.09 на живой отправке в тред 203: первый вызов отказал, второй без флага ушёл.
Связано: [[letter-into-a-standing-park-must-name-it]], [[run-park-under-checks-has-no-lifter]].
