---
name: role-worktree-has-no-node-modules
description: "ОТМЕНЕНО 17.09: дерево пары теперь ПОДНИМАЕТСЯ С node_modules, и почтовый CLI из него стартует; уцелел только флаг --head у pr open из главного чекаута"
metadata: 
  node_type: memory
  type: project
  originSessionId: 014b8b28-63d3-4a25-85b6-b9c249b9f570
  modified: 2026-09-17T09:49:44.088Z
---

**Главное, и оно перевёрнуто замером 2026-09-17 (`curator@218-…`): дерево пары поднимается
С `node_modules`** — и в корне, и в `packages/agent-protocol/`. Почтовый CLI стартует прямо
оттуда: `node --import tsx packages/agent-protocol/src/cli.ts thread show …` отработал первой
командой такта, `cd` в главный чекаут не нужен. Проверено на трёх деревьях подряд
(`curator@218-…`, `dev-core@186-…`, `dev-core@205-…`) — `node_modules` есть у всех.

**Грязи это не даёт:** `node_modules` тут настоящий каталог (не симлинк), его накрывает первая
строка `.gitignore` (`git check-ignore -v` → `.gitignore:1:node_modules/`), `git status --porcelain`
пуст. Старая ловушка «симлинк не подпадает под `node_modules/` со слешем и краснит дерево»
относилась к СИМЛИНКУ и к устройству до 17.09; заводить симлинк по-прежнему не надо — незачем.

**Цена на диске — не 153M на дерево, а ~11M:** каталоги жёстко слинкованы (pnpm), и `du -sh`
по ОДНОМУ дереву печатает 165M, а по набору — 153M один раз плюс ~11M на каждое. Отсюда
[[worktree-disk-cost-is-marginal-not-additive]].

**Что уцелело от старой заметки: у `pr open` ИЗ ГЛАВНОГО чекаута свой флаг — `--head`**
(замерено 2026-09-13, #405): `gh pr create` внутри команды читает ТЕКУЩУЮ ветку места запуска
(`main`) и отказывает — `aborted: you must first push the current branch to a remote, or use the
--head flag`, exit 2, PR не создан. Строка, которая проходит:
`pnpm protocol pr open --ref origin/main --head <своя ветка> --base main --title … --body-file … --write`.
Запуская из СВОЕГО дерева пары, флаг не нужен — текущая ветка там и есть своя.

**Why:** прежняя редакция гнала каждый такт в главный чекаут ради любой команды почты, а это
ровно тот путь, на котором правка абсолютным путём бьёт по главному дереву
([[absolute-path-edits-hit-the-main-checkout]]). Обход больше не нужен и стоит дороже прямого пути.

**How to apply:** почту читать и слать из СВОЕГО дерева пары. `node_modules` там не трогать
(он есть и он жёсткая ссылка). Прогон чужого дерева на исполнение — по-прежнему копией:
[[gitless-tree-copy-reddens-four-tests]], [[bare-mktemp-lands-inside-the-checkout]],
[[mutation-acceptance-runs-in-a-tmp-copy]].
