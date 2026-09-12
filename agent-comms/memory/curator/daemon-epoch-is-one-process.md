---
name: daemon-epoch-is-one-process
description: "Эпоха демона — ОДИН долгоживущий процесс, а такт ~36 с: «раз в N тактов» переводится в часы только замером"
metadata: 
  node_type: memory
  type: reference
  originSessionId: acc1233e-9443-4dd3-b7b3-e99a9eaa428a
  modified: 2026-09-12T18:00:56.444Z
---

Эпоха ящика (`agent-protocol: daemon — code: <sha> … up since <ISO>`) — это ЖИЗНЬ ОДНОГО
ПРОЦЕССА, а не серия запусков: строка `— code:` печатается один раз на всю эпоху (замер
2026-09-12: 5 строк на 6933 такта в `daemon.log.1`), и `ps -eo pid,etimes,lstart,cmd` находит
ровно один долгоживущий `node` демона с `etimes`, совпадающим с `up since`.

**Такт короче, чем кажется: ~36 с** (97 строк `^agent-protocol: daemon — no candidate is
launchable` за 59,7 минуты эпохи `316991aa`). Поэтому «раз в 60 тактов = раз в час» — ложь на
этом ящике; час стоянки это ~100 тактов, и число надо переводить замером, а не оценкой.

**Что это меняет в постановке:** состояние «сказать один раз за эпоху» НЕ требует поля на диске
и совместимости со старым форматом — хватает переменной процесса, как у `windDownAnnounced` /
`turnTakenAnnounced` (`cli.ts`, «said once per run … a line repeated every poll would be noise
in the one log an operator reads after the fact»). Прежде чем принимать «цену третьего поля в
json», мерь, не хватает ли памяти процесса.

Считать сами строки — [[field-state-is-read-from-the-daemon-log-file]], якорь `^` обязателен
([[daemon-log-echoes-your-own-output]]).
