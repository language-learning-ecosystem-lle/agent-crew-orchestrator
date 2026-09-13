---
name: park-door-refuses-a-conflicting-pr
description: "Парк `run:N` на конфликтующий PR дверь отказывает по имени — значит попытка парка это ещё и даровой оракул «моя ветка разошлась с main»"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 3a8f614a-99ab-41fc-9ce3-0c8397fc6b80
  modified: 2026-09-13T11:23:31.794Z
---

`new-message --parked-on run:N` отказывает, если PR конфликтует с базой: «PR #N is CONFLICTING, so
the merge ref is not assembled and **NO RUN WILL BE BORN** on head `SHA`: the park would wait for a
message the circuit has no reason to write». То есть попытка парка попутно меряет мержабельность
своей головы — отдельного `gh pr view --json mergeable` для этого не нужно.

**Почему это важно, а не просто отказ:** прогон на голове МОЖЕТ идти и быть зелёным (`gh pr checks`
покажет `pending`/`success`), пока merge-ref уже не собирается. Зелёный `checks` конфликта не
называет, а парк — называет, и называет до того, как такт уйдёт в ожидание письма, которого не будет.

**Как применять:** паркуясь на свой CI, отказ двери читать не как «парк не вышел», а как «ветка
разошлась с `main`». Починка — [[rebase-without-a-force-push]]: влить `origin/main` в ветку, разрешить
конфликт рукой, ff-push; номер PR и его круг целы. После push мержабельность GitHub пересчитывает не
мгновенно — мерить циклом по `gh pr view --json mergeable`, а не одним вызовом. Затем парковаться
заново на НОВУЮ голову ([[parked-on-run-takes-pr-number]]).

**Замер 2026-09-13, тред `180`, PR #386:** конфликт родил не мой дифф, а чужой merge того же дня в
ТОТ ЖЕ файл журнала роли (#385, тред `177`) — два попутных журнальных диффа дописывают в конец одного
файла, и второй merge делает первый конфликтующим. Класс держится и без журналов: любой файл, в конец
которого пишут двое. Доказывать разрешение — нулём удалений ([[manual-conflict-fix-needs-zero-deletions-proof]]).
