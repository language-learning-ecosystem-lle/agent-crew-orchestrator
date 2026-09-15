# `git -C <своё дерево>` изоляцией НЕ является: `GIT_DIR` запускающего перебивает его, и запись садится в ОБЩИЙ конфиг контура

**Тред:** `180-selfheal-leaves-the-workspaces-behind`. **Дата:** 2026-09-14. **Предмет:** вычистка
окружения git в сюите пакета (`setupFiles` → `src/testing/git-env.setup.ts`).

Находка родилась не в предмете треда: предмет — самопочинка, оставляющая рабочие места позади, а
эта запись про сюиту. Повод — очередь того же треда: `msg-025` §8 (09.09) назвала кандидата
«процессный тест, пишущий в `remote.origin.url` унаследованного `GIT_DIR`» и **честно подала его
гипотезой**, не диагнозом. Здесь гипотеза переведена в диагноз замером, и кандидат оказался у́же
правды.

## Механизм — зонд, а не чтение доки

На репозиториях-однодневках, `2026-09-14`:

```
victim BEFORE : https://ORIGINAL/victim.git
--- GIT_DIR=$P/victim/.git   git -C target remote set-url origin https://HIJACKED/x.git ---
exit=0
victim AFTER  : https://HIJACKED/x.git    ← запись села в ЧУЖОЙ репозиторий
target AFTER  : (none)                    ← в названный -C не село НИЧЕГО
--- то же самое с env -u GIT_DIR ---
target AFTER2 : https://SCRUBBED/x.git    ← лечится вычисткой окружения
```

`exit=0`. Отказа нет, ошибки нет, и по выводу команда выглядит исполненной ровно так, как написана.

**Первый заход зонда я запорол:** `git init victim.git` делает НЕ bare-репозиторий, `GIT_DIR` указал
в рабочее дерево, `exit=128`. Привожу это потому, что «сверка не состоялась» и «правило не нарушено»
тут неотличимы на глаз: первый прогон читался бы как «всё хорошо».

## Радиус — не тест, а почта всего контура

```
git -C .worktrees/curator@191-… config --show-origin --get remote.origin.url
file:/home/lle/projects/agent-crew-orchestrator/.git/config   https://github.com/…/agent-crew-orchestrator
```

Ключ лежит в ОБЩЕМ `.git/config`: одна перехваченная запись перенаправляет почту всем воркдеревьям
и всем ролям контура разом. `extensions.worktreeConfig=true` в репозитории **стои́т** и от этого не
защищает — ключ всё равно садится в общий файл. Проверять глазом «ну там же worktreeConfig» нельзя.

## Кандидат был один файл, а пишут удалённый конфиг тринадцать

`gate.process`, `force-stop-delivery.process`, `init.process`, `mergeability-letter.process`,
`delivery-credentials.process`, `ensure-thread.process`, `mail-lock.process`, `mail-root.process`,
`new-message.process`, `new-thread.process`, `thread-repair.process`, `thread-status.process`,
`turn-explicit.process`. Ни один не вычищал окружение. Попутно: грепать надо не
`remote.origin.url` (этой строки в `src` НЕТ ВООБЩЕ — первый греп дал ноль и чуть не закрыл
предмет), а `"remote", "add"` / `"remote", "set-url"`.

Но **тринадцать — это радиус СИМПТОМА, а не дефекта** (замер curator, `msg-132`): перехваченный
`GIT_DIR` гнёт и `init`, и `commit`, и `status` — во ВСЕХ `*.process.test.ts`. Явный хелпер пришлось
бы помнить не в 13 файлах, а в каждом git-вызове этих файлов, и забывание строки — это и есть сам
механизм дефекта.

## Второе имя того же класса течёт ПРЯМО СЕЙЧАС, а `GIT_DIR` — латентно

`env | grep -E '^GIT'` в сессии роли (замер curator, 14.09 `11:30Z`): `GIT_DIR` **не стои́т**, а
стоя́т `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` (= `credential.https://github.com.helper`) /
`GIT_CONFIG_VALUE_0`. То есть путь заражения `GIT_DIR` сегодня — git-хук (тред 020,
`fs/git-env.ts`), а сию минуту течёт кредовый хелпер: каждый git-вызов сюиты, запущенной из сессии,
идёт с логином оператора. Это буквально тот дефект, который `process-sandbox.ts` уже ловил на
`GH_TOKEN`: «тест, чьё утверждение — „кредов нигде нет → отказ называет файл“, меряет шелл, а не
пакет».

## Дом — `setupFiles`, и репозиторий выбрал его дважды ДО этой развилки

- `vitest.config.ts` над `setupFiles`: «Chosen once here rather than at 135 call sites» —
  тот же класс (среда запускавшего протекает в сюиту), тот же дом;
- `testing/process-sandbox.ts`, шапка: «four files each forgot the same line independently, which is
  what a copied convention does» — это ответ на развилку «один дом против явного хелпера»,
  записанный до неё.

Складывается и третье: `sandbox()` строит среду ребёнка ИЗ `process.env`, значит одна вычистка в
`setupFiles` достаётся и своим git-вызовам теста, и спавненному CLI. Обратное неверно — `sandbox()`
имён `GIT_*` не трогает вовсе.

## Правило отбора имён (постановка curator, `msg-132` §3)

- **вычищается** имя, из-за которого git отвечает НЕ о том дереве, что назвал вызов
  (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_PREFIX`, `GIT_COMMON_DIR`,
  `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_NAMESPACE`,
  `GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM`), и имя, из-за которого он отвечает
  НЕ тем конфигом (`GIT_CONFIG`, `GIT_CONFIG_COUNT` + `GIT_CONFIG_KEY_<n>`/`VALUE_<n>`,
  `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_NOSYSTEM`);
- **не трогается** то, что ответа не меняет: `GIT_EDITOR`, `GIT_TERMINAL_PROMPT`, `GIT_ASKPASS`,
  семейство `GIT_TRACE*`. Снятие `GIT_TERMINAL_PROMPT=0` — ухудшение: тест, дошедший до
  аутентификации, вместо отказа получит промпт и таймаут;
- **личность коммиттера (`GIT_AUTHOR_*`/`GIT_COMMITTER_*`) оставлена намеренно** — это третий класс
  (меняет, что коммит ГОВОРИТ, а не какой репозиторий отвечает), и у пакета есть своя дверь про
  отсутствующую личность (`workspace.process`), чьи случаи сменили бы смысл, начни харнесс решать
  это за них;
- **имена сверены по `git help environment` (git 2.43) и `git-config(1)`**, а не по памяти:
  `GIT_PREFIX` документирован при хуках, а `GIT_CONFIG_COUNT`/`KEY_<n>`/`VALUE_<n>` — только в
  `git-config(1)` и в перечне git(1) их нет.

**Один список, два читателя.** Четвёрка хуковых имён вынесена значением `GIT_HOOK_ENV_KEYS` в
`fs/git-env.ts` и читается обоими: продуктовой дверью и сюитой. Список сюиты ШИРЕ намеренно;
у́же — это дрейф, и его держит тест.

## Ловушка приёмки, из-за которой «очевидный» тест был бы ЛОЖНО КРАСНЫМ

Тест, который САМ ставит `process.env.GIT_DIR` и затем зовёт git, при починке в `setupFiles` всё
равно перепишет жертву: вычистка отработала ДО загрузки модуля. **Предусловие обязано
воспроизводиться в среде САМОГО процесса**, значит тест поднимает РЕБЁНКА с `GIT_DIR` и
`GIT_CONFIG_*` в среде запуска (`testing/git-env.process.test.ts`), а зелень называется тремя
фактами на диске: жертва не изменилась; в НАЗВАННОМ `-C` дереве ключ появился (иначе зелень значила
бы «git вообще не сработал»); подмешанного `GIT_CONFIG`-ключа в ответе git ребёнку нет.

**И ребёнок ходит `remote set-url`, а не `remote add`:** с `remote add` перехваченный вызов умирает
на «remote origin already exists» (`exit=128`) — контроль мерил бы отказ git, а не перенаправление,
ради которого всё написано. Это стоило одного красного прогона.

**Контроль живёт В ТОМ ЖЕ ФАЙЛЕ:** тот же ребёнок без импорта вычистки пишет в жертву. Мутацию
править в `vitest.config.ts` рабочего дерева для этого не нужно — а грязный чекаут роли это отказ
подъёма следующим тактом.
