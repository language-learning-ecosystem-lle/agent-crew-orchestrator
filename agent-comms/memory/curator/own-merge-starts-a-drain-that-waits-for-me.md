---
name: own-merge-starts-a-drain-that-waits-for-me
description: "Своя кнопка merge заводит слив ящика в ту же минуту, и слив ждёт ИМЕННО эту сессию — после merge ход сворачивается, а не продолжается"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7e0a5cd6-8e8f-4d9f-ba2a-fbc0274fcc75
  modified: 2026-09-08T14:22:58.677Z
---

Замерено 2026-09-08 (тред `173`, merge #342): squash лёг в `main` в `14:19:09Z`, а уже в `14:19:32Z`
— через 23 секунды — ящик написал `.orchestrator/self-restart.json` с `target` = МОЙ squash
(`46288a6b`, `from` 784f4d04, `behind: 1`, `at === drainSince`), и последняя строка
`.orchestrator/daemon.log`:

```
SELF-RESTART: this tick launches nothing — the box is draining to restart
(waiting for curator/173-daemon-self-restart) and there was nothing to withhold
```

То есть **слив держит ровно та сессия, которая нажала кнопку**, и очередь стоит, пока она не кончит
ход ([[drain-stalls-the-whole-queue]]). Никакого сигнала об этом в почте нет: узнаётся только
чтением `daemon.log`/`self-restart.json` в контуре.

Второе следствие, которое легко потерять: в перезапуск уходит процесс на СТАРОМ коде, поэтому
починка пути самоперезапуска не проверяется тем самым эпизодом, который её устанавливает
([[merged-code-is-not-running-code]]) — запись оставляет уходящий (старый) писатель, а читает её уже
новый преемник.

**Why:** после merge остаётся соблазн «раз я тут, домержу хвост / докопаю ещё предмет». Цена этого
теперь не абстрактная: каждая лишняя минута такта — минута, когда ящик не поднимает НИКОГО, и платят
её все треды, а не мой.

**How to apply:** merge ставить как ПОСЛЕДНЕЕ действие хода — след гарда 5 письмом и передача хода
сразу за ним. Хвост чужих PR мержить ДО своей кнопки или отдельным подъёмом, а не после.
