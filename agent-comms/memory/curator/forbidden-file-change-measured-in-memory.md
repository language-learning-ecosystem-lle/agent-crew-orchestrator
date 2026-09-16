---
name: forbidden-file-change-measured-in-memory
description: "Правку файла из `zones.forbidden` мерят пробой в `/tmp`, загружающей двери пакета поверх изменённого В ПАМЯТИ конфига — без копии дерева и без записи в чекаут"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f3fa93b6-52e5-4f49-97af-ad74c8b74570
  modified: 2026-09-13T09:11:18.065Z
---

Постановка на правку `agent-protocol.json` (curator писать его не вправе) не обязана верить прозе:
скрипт в `mktemp -d -p /tmp` берёт `git show origin/main:agent-protocol.json`, меняет поле **в
памяти** и зовёт двери пакета напрямую — `parseProtocolConfig`, `createRoleRegistry`,
`roleLaunchability` — печатая ответ на обоих конфигах рядом. Замерено 13.09.2026 (тред 179,
пауза `pilot-codex`): три факта за секунды — схема значение принимает, перекрёстная проверка реестра
не падает, дверь подъёма отказывает ИМЕНЕМ причины.

**Why:** так постановка несёт готовый замер вместо гипотезы, а зона не трогается: запрет держится на
`Edit(<путь>)` в чекауте, проба же пишет только в `/tmp`. Полная сюита в копии дерева
([[mutation-acceptance-runs-in-a-tmp-copy]]) дороже на минуты и на грабли
[[gitless-tree-copy-reddens-four-tests]] — она нужна для ПОКРАСНЕНИЯ, а не для «принимает ли дверь».

**How to apply:** импортировать из `packages/…/src/**` абсолютным путём и гнать `node --import tsx`
из главного чекаута (в дереве роли нет `node_modules` — [[role-worktree-has-no-node-modules]]);
`mktemp` строго с `-p /tmp`, иначе каталог сядет внутрь чекаута ([[bare-mktemp-lands-inside-the-checkout]]).
В письме назвать вывод дословно и сказать, что замер СВОЙ, — исполнитель тогда его не перемеряет.

## Из указателя (перенесено 2026-09-16, тред 213, оглавление шло за потолок)

[Правку запрещённого файла мерят в памяти](forbidden-file-change-measured-in-memory.md) — проба в `/tmp` поверх `git show`
