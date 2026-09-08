# Стоячий адрес: контур разобрал (или не разобрал) дерево роли

participants: github, dev-core, curator · status: open

## msg-001 · from: github · 2026-09-08 · expects: none

## Контур закоммитил незакоммиченную работу роли `dev-core` — она лежит в `wip/dev-core/172-merge-gate-still-falls-on-private-20260908T1350Z`

Прогон кончился, не закоммитив своё дерево. Контур сделал это за него: дерево чисто, роль поднимается ближайшим тиком — **и вот адрес работы, потому что больше его нигде нет.**

- **роль:** `dev-core`
- **дерево:** `/home/lle/projects/agent-crew-orchestrator/.worktrees/dev-core`
- **тред прогона:** `172-merge-gate-still-falls-on-private`
- **что лежало:** 3 path(s) — packages/agent-protocol/src/cli.ts (modified, +7/-1), packages/agent-protocol/src/orchestrator/self-restart-letter.ts (modified, +28/-7), packages/agent-protocol/src/orchestrator/self-restart.ts (modified, +65/-6)
- **куда положено:** ветка `wip/dev-core/172-merge-gate-still-falls-on-private-20260908T1350Z`, коммит `fc380be7`
- **push:** прошёл — ветка есть и на `origin`.

**Ход ваш — ровно на одно решение:** забрать эту ветку в работу или удалить её, сказав почему. Удаления контур не делает (решение по треду 099): конец служебной ветки — рука роли.

## msg-002 · from: dev-core · 2026-09-08 · expects: none

## Решение: ветку удалил — её содержимое целиком перекрыто живым PR #342

Ветка `wip/dev-core/172-merge-gate-still-falls-on-private-20260908T1350Z` (коммит `fc380be7`,
родитель `d3a07723`) удалена — и на `origin`, и локально. Рабочее дерево `.worktrees/dev-core`
чисто, других `wip/*` в репозитории не осталось.

### Почему удалил, а не забрал в работу

**Имя ветки называет тред ПРОГОНА, а содержимое принадлежит другому треду.** Диффом:
все три файла — правка письма самоперезапуска, и комментарии внутри дословно ссылаются на
**тред 173**, не на 172. Дом предмета — `173-daemon-self-restart`.

**У этого предмета уже есть живой PR — #342 `fix/self-restart-letter-unrecorded-go`,
голова `63cc7490`, база та же `d3a07723`.** Состояние на момент замера: `checks` **pass** (8m3s),
метка `review` висит, круг ревьюера **pending** — работа идёт, не брошена.

**Перекрытие измерено посимвольно, не на глаз** — каждая мысль снимка есть в PR #342 в более
развитой форме:

| в снимке `fc380be7` | в #342 |
| --- | --- |
| `wentStampOf` — чтение ФОРМЫ старой записи (`drainSince !== at` ⇒ `at` и есть ход) | `selfRestartWent` — та же форма, экспортирована и покрыта тестами |
| `went?: string` в памяти | `went?: true` + различитель `repair: "went" \| "unrecorded"` |
| `wentLine` — строка «когда пошёл: НЕ ЗАПИСАНО» | те же две строки в рендере + СМЕНА ЗАГОЛОВКА и первой фразы письма у ветви `unrecorded` |
| `waitedLine(event)` вместо числа | то же, плюс `waitedForSec` вообще не спрашивается у незаписанного хода |
| — | `docs/protocol-reference.md`, `self-restart.test.ts`, `self-restart-letter.test.ts`, `self-restart.process.test.ts` (+222 строки тестов) |

Ничего, что есть в снимке и чего нет в #342, я не нашёл.

**И сам снимок не собирается** — это середина правки, а не годная работа: сигнатура сменилась на
`waitedLine(event: SelfRestartEvent)`, а вызов остался `waitedLine(event.waitedForSec)`;
`wentLine` объявлена и не вызвана ни разу. Забирать такое в работу поверх зелёного PR значило бы
завести второй дом одному предмету.

### Что осталось на записи

SHA снимка — `fc380be709c64015b5fc1a910ff1eef49fd7a26b` — назван здесь на случай, если он всё же
понадобится, пока объект не собран сборщиком.

### Кто действует дальше

По этому треду — никто: адрес стоячий, решение по его единственному письму принято и исполнено.
Хода ни на кого не вешаю. Предмет треда 173 живёт своим ходом в #342 — там идёт круг ревьюера, и
он отчитается в свой тред сам.

## msg-003 · from: github · 2026-09-08 · expects: none

## Контур закоммитил незакоммиченную работу роли `dev-core` — она лежит в `wip/dev-core/177-workspace-per-pair-20260908T1855Z`

Прогон кончился, не закоммитив своё дерево. Контур сделал это за него: дерево чисто, роль поднимается ближайшим тиком — **и вот адрес работы, потому что больше его нигде нет.**

- **роль:** `dev-core`
- **дерево:** `/home/lle/projects/agent-crew-orchestrator/.worktrees/dev-core`
- **тред прогона:** `177-workspace-per-pair`
- **что лежало:** 6 path(s) — packages/agent-protocol/src/config/config.ts (modified, +33/-0), packages/agent-protocol/src/schema/migrate.ts (modified, +2/-0), packages/agent-protocol/src/schema/shape.ts (modified, +107/-0), packages/agent-protocol/src/schema/version.ts (modified, +1/-1), packages/agent-protocol/src/config/pairs.ts (untracked, not counted), and 1 more not listed here ('git -C <workspace> status --porcelain' has all of them)
- **куда положено:** ветка `wip/dev-core/177-workspace-per-pair-20260908T1855Z`, коммит `4dd63b0d`
- **push:** прошёл — ветка есть и на `origin`.

**Ход ваш — ровно на одно решение:** забрать эту ветку в работу или удалить её, сказав почему. Удаления контур не делает (решение по треду 099): конец служебной ветки — рука роли.
