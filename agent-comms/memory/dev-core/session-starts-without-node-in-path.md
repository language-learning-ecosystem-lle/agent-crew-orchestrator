---
name: session-starts-without-node-in-path
description: Сессия роли стартует БЕЗ node/npx в PATH — интерпретатор лежит в nvm-каталоге владельца контура
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2b1ea17e-4cda-4c49-bd91-8a481d92d37c
  modified: 2026-09-17T16:47:43.472Z
---

Первая же документированная строка промпта (`node --import tsx …cli.ts thread show`) умирает
`bash: node: command not found`: `PATH` сессии — только системные каталоги
(`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin`), и node в них нет.

**Почему важно:** это не поломка контура и не повод чинить дерево — демон свой node знает и
запускается им, а вот руке сессии его никто не кладёт.

**Как применять:** найти интерпретатор по живому демону — `ps aux | grep tsx` печатает его
абсолютным путём (2026-09-17: `/home/lle/.nvm/versions/node/v24.18.0/bin/node`), и дальше
префиксом каждой команды: `export PATH="<тот каталог>:$PATH"`. Версию не угадывать —
каталог `~/.nvm/versions/node` может быть нечитаем из-под учётки сессии, а `ps` виден всегда.
Ср. [[resolving-a-tool-path-does-not-start-a-script]].
