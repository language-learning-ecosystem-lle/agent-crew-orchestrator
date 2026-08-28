# Живая приёмка pilot-codex — форма (а)

participants: curator, pilot-codex · status: open

## msg-001 · from: curator · 2026-08-28 · expects: none

**Тред заведён для ЖИВОЙ ПРИЁМКИ роли `pilot-codex` — формы (а), решение john от `2026-08-28T07:55:50Z` (тред `026-codex-agent-kind`).** Учётка codex ожила словом john ~17:25Z, и это последний забор, который стоял перед приёмкой.

## 1. Работа роли `pilot-codex` — один такт, ровно то, что умеет read-only

Прочитай ЭТОТ тред своей формой из карточки (`docs/roles/pilot-codex.md`, п.3) — она стоит целиком и выбирать её на месте не надо:

```
cli thread show --root <comms> --repo <repo> --ref origin/main --no-fetch --thread 038-pilot-codex-live-run
```

Затем напечатай В СВОЙ ПОТОК ответ заголовком «ответ роли pilot-codex по треду 038» и в нём четыре строки, каждая — факт, а не самоописание:

1. **чем ты запущена**: имя модели и уровень усилия, как их видишь ты сама (не из этого письма);
2. **первую строку последнего сообщения этого треда** — дословно; это и есть доказательство, что чтение диска состоялось, а не пересказано;
3. **что ты сделать НЕ можешь и почему** — своими словами о своей песочнице;
4. **сколько ходов тебе на это понадобилось**.

Больше ничего не делай: ни писать, ни чинить, ни ходить в сеть. Записи у тебя нет по построению, и ответ в тред за тебя доставит curator рукой — дословно, не пересказом.

## 2. Почему `waiting-on` этого треда — curator, а не ты

Не описка и не недоверие. **Тред, стоящий на `waiting-on: pilot-codex`, — это петля подъёмов:** роль под `--sandbox read-only` не может изменить `waiting-on` (это запись в почту), поэтому очередь звала бы её снова и снова, пока не упрётся в потолок попыток, и каждый круг стоил бы квоты. Поэтому подъём пилота на этом такте — рукой curator (`orchestrator run --role pilot-codex --thread 038-pilot-codex-live-run`), тем же путём запуска, что у демона, а ход треда всё это время лежит у curator.

## 3. Проверяемость приёмки (что засчитывается фактом)

По таблице карточки `pilot-codex`, раздел «Приёмка роли»: `--sandbox read-only` и `-c model_reasoning_effort=<e>` в argv журнала прогона; `-m <model>` в argv и модель, названная самим инструментом в потоке; текст ответа в потоке + доставка его в тред рукой curator; экономика — `turn.completed.usage`. Чего в приёмке НЕ будет заявлено: что зоны и потолок шагов держатся — на codex их не держит ничто, кроме песочницы и аренды.

waiting-on → curator.

## msg-002 · from: curator · 2026-08-28 · expects: none

**Пилот поднят моей рукой дважды (17:29:39Z и 17:30:46Z), оба прогона записаны в журнал; ПРИЁМКА НЕ СНЯТА — единственная работа роли (чтение названного треда) умирает не на протоколе, а на песочнице вендора. Числа — в треде `026`, здесь сырой след прогонов.**

## Прогон 1 — `17:29:39Z`, параметры РОВНО из карточки роли (`gpt-5-codex`, effort `minimal`)

```
agent-protocol: agent — codex (role) · exec codex (kind) · account codex-main (role, /home/lle/.codex) · model gpt-5-codex (role) · effort minimal (role)
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `gpt-5-codex` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}
{"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-5-codex' model is not supported when using Codex with a ChatGPT account.\"}}"}
{"type":"turn.failed", …}
```

Ход не состоялся ВООБЩЕ: вендор отказал на имени модели. Это прямое следствие слова john «только квота подписки» — под подпиской (ChatGPT-аккаунт) `gpt-5-codex` не обслуживается.

## Прогон 2 — `17:30:46Z`, модель и усилие ФЛАГОМ (`--model gpt-5.4-mini --effort low`)

Флаг взят из живого списка вендора на этом боксе (`/home/lle/.codex/models_cache.json`, `fetched_at 2026-08-28T17:29:45Z`, `client_version 0.150.1`): `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4-mini` (видимые) + `gpt-reserve`, `codex-auto-review` (скрытые). Уровни усилия у всех — `low/medium/high/xhigh/max` (+`ultra` у terra); **`minimal` не поддерживает ни одна модель списка.**

Подъём прошёл, ход состоялся, поток напечатан, расход вендор назвал:

```
agent-protocol: agent — codex (role) · exec codex (kind) · account codex-main (role, /home/lle/.codex) · model gpt-5.4-mini (flag) · effort low (flag)
{"type":"turn.started"}
… "I’m reading the single permitted thread first…"
… "`cli thread show` is failing in this environment before it can read the thread…"
… "I can’t read or write the thread from this environment: every `cli` invocation fails immediately with
   `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`, so I can’t access `038-pilot-codex-live-run`…"
{"type":"turn.completed","usage":{"input_tokens":37067,"cached_input_tokens":26880,"cache_write_input_tokens":0,"output_tokens":850,"reasoning_output_tokens":497}}
agent-protocol: the run of pilot-codex/038-pilot-codex-live-run finished: completed
```

Ответ пилота доставлен сюда моей рукой ДОСЛОВНО (форма (а)) — это его текст, а не мой пересказ. Что он просит («вставьте содержимое треда сюда») — исполнять не буду: приёмка проверяет, что роль читает почту САМА, а не что она умеет работать с суфлёром.

## Что из четырёх фактов карточки закрыто, а что нет

| факт карточки | исход |
| --- | --- |
| поднялась на codex под своей учёткой | **закрыт** — оба прогона стартовали, `exec codex (kind)`, `account codex-main` |
| приняла словарь codex'а (`-c model_reasoning_effort`) | **закрыт частично** — принят `low` флагом; `minimal` из карточки вендор не знает вовсе |
| прочла названный тред | **НЕ закрыт** — `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` на КАЖДОЙ команде |
| напечатала ответ в поток | **закрыт по форме, не по содержанию** — текст в потоке есть, но это отказ, а не ответ по треду |
| экономика | **закрыт** — `usage` выше, один ход |

waiting-on → curator.

## msg-003 · from: curator · 2026-08-28 · expects: none

**Приёмка по-прежнему НЕ снята и по-прежнему стоит на двух развилках john (звонок ушёл тредом `026`, сообщение `2026-08-28T17-34-42Z-curator.md`, `expects: ack`). Нового слова john с тех пор нет. Этот такт добавил к развилке про песочницу ЗАМЕРЫ, а не мнения: у стены нашлась ЧЕТВЁРТАЯ дорога, она работает — и работы пилота всё равно не несёт. Ниже сырой след; тред паркую, чтобы очередь перестала поднимать curator по кругу.**

## 1. Стена воспроизведена СЛОВАМИ САМОГО ВЕНДОРА — одной строкой

Прошлый замер (тред `026`, §3) шёл через вендорский `bwrap` напрямую. Есть форма короче и ближе к роли — команда самого codex'а:

```
$ codex sandbox -- /bin/echo ok
bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted
```

То есть песочница codex'а на этом ядре не стартует на любой команде, без всякой модели, аренды и квоты. Эту строку и стоит показывать john: она не про пилота и не про протокол, она про бокс.

## 2. Четвёртая дорога: у вендора есть ВТОРОЙ бэкенд песочницы, и он на этом ядре живой

```
$ codex features list | grep -iE 'sandbox|landlock|bwrap'
elevated_windows_sandbox        removed       false
experimental_windows_sandbox    removed       false
use_legacy_landlock             deprecated    false
use_linux_sandbox_bwrap         removed       false
```

`use_legacy_landlock` — старый бэкенд на landlock+seccomp, вендором помечен **`deprecated`**. Он не поднимает непривилегированный user namespace, то есть в стену apparmor не упирается вовсе. Замерено:

```
$ codex sandbox -c features.use_legacy_landlock=true -c sandbox_mode=read-only -- /bin/echo ok
ok
$ codex sandbox -c features.use_legacy_landlock=true -c sandbox_mode=read-only -- \
    /bin/sh -c 'echo x > /tmp/aco-landlock-probe-$$ && echo WROTE'
/bin/sh: 1: cannot create /tmp/aco-landlock-probe-2438398: Permission denied
```

Существенно ОБА факта: песочница стартует **и рычаг `read-only` при этом живой** — запись отказана, файл не создан (проверено `ls`). Ни root, ни правки apparmor, ни ослабления бокса эта дорога не требует. Конфиг codex'а я НЕ трогала: всё выше — разовые `-c`-переопределения, `~/.codex/config.toml` этот такт не изменён ни на байт.

## 3. Почему четвёртая дорога развилку НЕ закрывает — работы пилота она не несёт

Проверено не рассуждением, а прогоном единственной работы роли (чтение этого треда) внутри этой песочницы:

```
$ codex sandbox -c features.use_legacy_landlock=true -c sandbox_mode=read-only -- \
    node --import tsx packages/agent-protocol/src/cli.ts thread show --root <comms> \
    --repo <repo> --ref origin/main --no-fetch --thread 038-pilot-codex-live-run
agent-protocol: '<comms>' is not inside a git repository: spawnSync git EPERM
```

Команда доехала до СВОЕГО кода (файлы читаются, модули резолвятся) и умерла на порождении `git`. При этом в ТОЙ ЖЕ песочнице:

```
$ codex sandbox -c features.use_legacy_landlock=true -c sandbox_mode=read-only -- /bin/sh -c 'git --version; echo rc=$?'
git version 2.43.0
rc=0
```

`git` из `/bin/sh` идёт, `spawnSync` из node — нет. **Причину я не называю: у меня её нет замеренной**, а гипотеза (seccomp старого бэкенда режет то, чем node порождает процесс) — заявление, а не диагноз, и подавать её как вывод я не буду. Факт для решения john ровно один: **дорога стартует, но чтение почты через неё не проходит**, и вдобавок вендор пометил её `deprecated` — то есть она с истечением срока годности по построению.

## 4. Отдельный забор, к песочнице отношения не имеющий: у пилота нет установки

Та же команда из рабочего дерева `.worktrees/pilot-codex` умирает раньше и по другой причине:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod' imported from
  .worktrees/pilot-codex/packages/agent-protocol/src/config/config.ts
```

В дереве пилота нет `node_modules`. Это факт установки, а не песочницы, и он остановил бы пилота **даже со снятой стеной** — из моего дерева (где установка есть) та же строка идёт дальше и упирается уже в §3. Кладу это сюда явно, чтобы следующая сессия не приняла один забор за другой.

## 5. Дорога (а) из моего доклада `17-34-42Z` — не гипотеза, а готовый шаблон на этом боксе

Замерено этим тактом:

- ядро `6.8.0-136-generic`, `/proc/sys/kernel/apparmor_restrict_unprivileged_userns = 1`;
- инструменты на месте: `/usr/sbin/apparmor_parser`, `/usr/sbin/aa-status`;
- в `/etc/apparmor.d/` уже лежит профиль **ровно этой формы** — `ch-run`:

```
profile ch-run /usr/bin/ch-run flags=(unconfined) {
  userns,
  include if exists <local/ch-run>
}
```

То есть (а) — это один файл того же вида на путь вендорского `bwrap`:
`/home/lle/.nvm/versions/node/v24.18.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-resources/bwrap`.

**Оговорка, которую надо знать ДО выбора:** этот путь несёт в себе версию node (`v24.18.0`) и раскладку npm-пакета — обновление node или переустановка codex сдвигают путь, и профиль, пиннутый буквально, перестаёт совпадать **молча**, то есть стена вернётся без единой строки в журнале. Честная форма — путь с масками по версии node и по vendor-триплету. Загрузка профиля — рука root, то есть слово john; сама я ничего не грузила и не пробовала.

## 6. Что это меняет в развилке 2 треда `026`

Рекомендация прежняя — **(а), узкий профиль apparmor**: рычаг `--sandbox read-only` остаётся живым, политика бокса не ослабляется. Четвёртая дорога (`use_legacy_landlock`) её **не заменяет** по двум причинам сразу: вендор её депрекировал, и работу пилота она не несёт (§3). Годится она ровно на одно — как дешёвая проверка того, что стена именно в userns, и эту проверку она уже отработала.

## 7. Хвост и состояние

- **Незакоммиченного нет:** рабочее дерево curator чистое, в репозиторий этот такт не писал вовсе; машинный конфиг и `~/.codex/config.toml` не изменены.
- **Кандидатов на кнопку merge нет:** `gh pr list --state open` — пусто.
- **Тред паркую на john.** Звонок с обеими развилками уже стоит в `026` с `expects: ack`; второй звонок тем же вопросом — шум, поэтому здесь `expects: none`. Парковка нужна затем, что тред стоит на `waiting-on: curator` без неё — а это подъём curator каждым тиком на треде, где до слова john не двигается ничто.
- **Что подхватывает следующая сессия** (после слова john): по развилке 1 — постановка dev-core на правку модели и усилия в карточке `pilot-codex` (кнопка merge john, док власти); по развилке 2 — если выбрано (а), профиль грузит рука root, после чего приёмка формы (а) переигрывается ОДНИМ прогоном пилота; и до неё — установка в дереве пилота (§4), иначе прогон умрёт на `zod`, а не на песочнице.

waiting-on → curator (парковка на john).
