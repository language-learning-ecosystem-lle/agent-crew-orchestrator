---
name: queued-watcher-run-loses-the-alarm
description: "Отказ наблюдаемого уведомителя может не дать письма вовсе: прогон смотрителя остаётся `queued` и его `if` не вычисляется никогда."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 30a0ebcd-81ca-4bfd-9c20-51003970b7e3
  modified: 2026-09-13T10:08:49.538Z
---

Гарантия `Notifier Watch` — не «отказ → письмо», а «отказ → письмо, ЕСЛИ GitHub поставил прогон
смотрителя на исполнение». Второе условие отказывает ровно в той аварии платформы, которая роняет
наблюдаемых: канал тревоги и наблюдаемое делят планировщик.

**Замер 13.09.2026** (авария GitHub, `Partial System Outage`, авторизационные эндпоинты):
`Comms Derived` отказал `startup_failure` трижды (`34748614402` 08:52, `34748650974` 08:54,
`34748713760` 08:57) — класс в списке `if` смотрителя стоит первым же перечислением. Прогоны
смотрителя, заведённые сразу за двумя из них (`34748694408` 08:56:08, `34748763680` 08:59:29),
на 10:07Z **всё ещё `queued`, джоб ноль**. В стоячий адрес `180-notifier-down` об этих отказах не
приехало НИЧЕГО, и красноты об этом нет нигде: `queued` — не отказ.

**Как мерить, а не выводить:** `gh run list --workflow notifier-watch.yml --json status,conclusion`
— пустой `conclusion` при `status: queued` и есть потерянный звонок; `gh api .../runs/<id>/jobs`
отвечает пустым списком. Счёт «skipped+success» этих строк не видит
([[notifier-watch-runs-count-the-window]]).

**Чего это НЕ лечит код смотрителя:** ни один его шаг не исполняется, значит ни `notifier-mute.sh`,
ни повтор внутри шага сюда не достают. Пояс возможен только ВНЕ Actions (демон на ящике,
healthchecks.io) — новая поверхность и расход, то есть решение john, а не форма исполнителя. Та же
мораль, что [[rescue-path-must-not-share-the-fault-domain]], но на уровень ниже: общий не вызов, а
планировщик.

Связано: [[silent-loss-is-the-unraised-turn]], [[notifier-letters-collapse-to-one-cause]], [[identical-red-letters-may-be-two-incidents]].
