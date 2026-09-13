---
name: carrying-a-park-forward-redeclares-it
description: "Перенос парка тем же значением НЕ обновляет его: `since`/вопрос/`ground` остаются первого письма — новый парк начинает только `--park-lifted` + `--parked-on` в одном письме"
metadata: 
  node_type: memory
  type: project
  originSessionId: a957c402-27d8-4035-924c-2d46115441a5
  modified: 2026-09-13T13:17:26.633Z
---

**Имя файла — легаси эпохи до #339; поведение ОБРАТНОЕ.** `standingParkOf` идёт с конца ленты до
первого `parked-on:` и отдаёт не его, а `declaredAt(...)` — walk назад по письмам с ТЕМ ЖЕ
значением (`thread/thread.ts`, `declaredAt`). Повтор `--parked-on <то же>` — это **носитель**
стоящего парка: `since`, вопрос, `holder` и `park-ground` остаются ПЕРВОГО письма, потолок тикает от
него. Новый парк начинает только письмо, которое **гасит по имени и объявляет в одном вдохе**
(`--park-lifted run:N` + `--parked-on run:N`: `declaredAt` возвращает само это письмо; правка треда
188 от 11.09).

**Why:** замер curator 13.09 (тред 155, PR #388): парк `run:388` объявлен `11:35:14Z`, два честных
переноса (`13:03:26Z`, `13:11:45Z`) его не обновили — в `daemon.log` **103 строки** `HAS GONE STALE
— declared 2026-09-13T11:35:14Z`, возраст растёт до 99 мин против потолка 30. Пара поднимается
КАЖДЫЙ такт, и «мой новый парк молод и держит» — ошибка чтения, которую я записала в ленту прежде
замера.

**How to apply:** переносишь парк — знай, что курьеру видны поля ПЕРВОГО письма, а возраст твоего
парка старше твоего письма; хочешь настоящие 30 минут тишины — гаси и объявляй одним письмом.
Увидела пару, которую поднимает мёртвый `run:N`, — гаси `--park-lifted`, не жди потолка
([[run-park-under-checks-ends-only-by-ceiling]]). Под живым `checks` парк не ставится вовсе
([[no-park-beats-run-park-under-live-checks]]).

**Переобъявление НЕ обязано звонить, и это замерено** (curator, 2026-09-13, тред 177): письмо
`--parked-on john --expects none` (парк как СТРОКА СОСТОЯНИЯ, легальная форма по `usage`) оставило в
`notify.state` прежние два ключа `asked john … 177-workspace-per-pair` (`11:24:53Z`, `12:05:28Z`) и
третьего не добавило, а ключ `parked john` остался стоять. Звонит `--expects ack`, а не сам парк.

Смежное: [[park-door-refuses-silent-letters]], [[parked-on-freezes-the-turn]],
[[letter-without-a-park-reraises-the-thread]], [[park-bell-carries-the-old-first-line]].
