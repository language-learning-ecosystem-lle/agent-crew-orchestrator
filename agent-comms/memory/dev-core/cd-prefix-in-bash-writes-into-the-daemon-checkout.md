---
name: cd-prefix-in-bash-writes-into-the-daemon-checkout
description: "`cd <главный чекаут> && cat >> file` пишет в дерево ДЕМОНА, а не в своё рабочее место — и грязнит его"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d6074103-ac97-4e12-b7f3-0afae5437bdc
  modified: 2026-09-13T11:03:28.521Z
---

Оболочка каждого вызова стартует в рабочем месте роли, но префикс
`cd /home/lle/projects/agent-crew-orchestrator && …` уводит ВСЮ команду в чекаут демона.
Чтения там правильны (код ящика, `.orchestrator/*`), а любая ЗАПИСЬ — грязнит его дерево.

Полевой случай 2026-09-13: `cd <главный> && cat >> docs/journal/dev-core.md` уложил 33 строки
записи журнала не в ветку, а в чекаут демона; поймано следующим `git status`, снято
`git checkout --` одного пути, дерево жило грязным около минуты.

**Why:** грязный чекаут демона — это `stand` самоперезапуска («no self-restart with
uncommitted work»): ящик отказывается встать на новый код, пока дерево не чисто. То есть
случайная запись туда останавливает обновление ящика, и увидит это не автор, а следующий
читатель `daemon.log`.

**How to apply:** писать (`cat >>`, `Write`, `Edit`, `git add`) — только без `cd`-префикса,
в своём дереве. `cd` в главный чекаут оставлять для команд, которые ТОЛЬКО читают
(`orchestrator run` сухим, `status`, `cat .orchestrator/…`). После любого такта сверять
`git -C <главный чекаут> status --porcelain -uall` — пусто.
