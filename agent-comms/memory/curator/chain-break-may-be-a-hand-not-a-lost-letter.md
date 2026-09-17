---
name: chain-break-may-be-a-hand-not-a-lost-letter
description: "Разрыв стыка «был → стал» в стоячем адресе — чаще рука, чем потерянное письмо; мерится строками SELF-RESTART в daemon.log"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0610d734-e8a9-4eeb-9a51-1981e86e9c0e
  modified: 2026-09-17T13:15:58.846Z
---

Стоячий адрес самоперезапуска показывает только УДАЧНЫЕ САМОперезапуски. Ни рука
(`orchestrator restart --pull` / `up`), ни УПАВШИЙ перезапуск в ленту не пишут и не могут: после
`nothing was raised, the circuit stays down` процесса уже нет. Поэтому разрыв стыка «мой прошлый
доклад кончался на X, письмо начинается с Y» — законный исход, а не улика потери письма.

Мера, снимающая вопрос за одну команду: **есть ли в `daemon.log` между двумя эпохами строка
`SELF-RESTART:`**. Нет ни одной → звено двигала рука (её видно по префиксу `[restart <ts>]` и по
тому, что она успевает за секунды после committer-даты цели, а автоматике мешает порог дрейфа —
замерен как 406 с). Есть → это ящик, и поля письма сверяются как обычно.

Не заводи дефект на механизме письма, пока эта мера не сделана: предмет упавшей руки — чужой тред,
а не [[self-restart-letter-names-the-footprint]]. Смежное: [[self-restart-runs-the-old-binary]],
[[self-restart-record-is-single-slot]], [[daemon-log-echoes-your-own-output]].

Второй замер того же такта: подъём рукой оставляет ящик ВНЕ systemd — `/proc/<pid>/cgroup` =
`…/session-NNNN.scope`, `PPid 1`, `INVOCATION_ID` в окружении нет, баннер эпохи печатает
`background` вместо `foreground`. На таком ящике самоперезапуск идёт не кодом 75 под супервизором, а
ветвью `this process is not supervised — spawning the restart the way a hand would type it`
(замерено 2026-09-17: сработала успешно; пропуск `pnpm install` на ней не действует). Самоперезапуск
наружу из systemd выживает, надзор — нет.
