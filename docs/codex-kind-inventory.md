# Инвентаризация допущений `claude-code` и что под ними у Codex

Тред `026-codex-agent-kind`, шаг 1 постановки. Документ отвечает на один вопрос: **где в пакете
`agent-protocol` знание об исполнителе `claude-code` вшито в код**, и **что стоит на том же месте у
Codex CLI**. Это опись, а не проект интерфейса: интерфейс исполнителя (шаг 2) строится по ней.

Всё, что сказано про Codex, снято **фактом** — из исходников `openai/codex@main` (тег npm
`@openai/codex@0.149.0`) и из `developers.openai.com/codex/*.md`. Каждое утверждение несёт свой
источник. Ничего не взято по памяти.

---

## A. Опись мест, где живёт `claude-code`

Восемь стыков. Порядок — от спавна к разбору того, что он выплюнул.

### A1. Резолв бинаря и учётки

| место | что вшито |
| --- | --- |
| `packages/agent-protocol/src/orchestrator/launch.ts:395` | `DEFAULT_EXEC = "claude"` — имя бинаря по умолчанию для kind, о котором машина ничего не сказала |
| `packages/agent-protocol/src/orchestrator/launch.ts:177` | `DEFAULT_WORKER = "claude-code"` — kind по умолчанию |
| `packages/agent-protocol/src/config/local.ts:77-80` | `localAgentSchema` — на машине у kind есть РОВНО одно поле, `exec`. Больше о вендоре машина сказать не может |
| `packages/agent-protocol/src/config/local.ts:112-121` | `localAccountSchema.configDir` — «каталог учётки», и комментарий прямо называет его `CLAUDE_CONFIG_DIR` |
| `packages/agent-protocol/src/cli.ts:7285` | спавн подставляет `CLAUDE_CONFIG_DIR: p.account.configDir` — **имя переменной вендора захардкожено в env спавна** |
| `packages/agent-protocol/src/cli.ts:5533` | то же имя во второй раз, в пробе `doctor` |

Вывод: место `kind → чем аутентифицируется` в схеме уже есть (`accounts[].configDir`), но **имя
переменной окружения — нет**, оно вписано в две точки кода.

### A2. Сборка argv

`packages/agent-protocol/src/orchestrator/launch.ts:762-805`, `buildLaunchArgv`. Формат — целиком
`claude-code`:

```
[--resume <id>] -p <prompt> --allowedTools <a,b,c> [--settings <json>]
--max-turns <n> [--model <m>] [--effort <e>] --output-format stream-json --verbose
```

Каждый из семи флагов — допущение о вендоре: `-p` как «промпт», `--allowedTools` как список
инструментов через запятую, `--settings` с JSON-объектом `permissions.deny`, `--max-turns` как
потолок шагов, `--output-format stream-json --verbose` как способ получить поток.

### A3. Параметры модели и effort

| место | что вшито |
| --- | --- |
| `packages/agent-protocol/src/roles/schema.ts:228` | `claudeCodeEffortSchema = z.enum(["low","medium","high","xhigh","max"])` — **закрытый список уровней ОДНОГО вендора** |
| `packages/agent-protocol/src/roles/schema.ts:257` | `kind: z.literal("claude-code")` — член union'а, ключёванного по инструменту. Расширение kind'ов — это добавление члена, а не правка существующего |
| `packages/agent-protocol/src/orchestrator/launch.ts:578-590`, `644-654` | двери: `--model/--effort` и директива треда отказываются применяться, если `worker !== "claude-code"`, **по имени и с причиной** |
| `packages/agent-protocol/src/cli.ts:2391-2393` | та же проверка на двери сообщения (`--effort`) |
| `packages/agent-protocol/src/schema/v4-agent-params.ts` | миграция 3→4, заводившая `roles[].launch.agent` |

Хорошая новость: отказы здесь уже названы по имени (дисциплина 4), то есть новый kind не «тихо
теряет» model/effort, а получает предсказуемый отказ до реализации.

**Состояние на шаг 4 (тред `026`).** Первые три строки таблицы описывают опись, а не сегодняшний
код: union принял второго члена (`kind: z.literal("codex")` с одним полем `model`), а дверь
`resolveAgentParams` спрашивает KIND вместо сравнения строки — `--model`/`--effort` доезжают до
любого реализованного kind'а, `effort` отказывается по имени тому, у кого рычаг стоит в `cannot`,
незнакомый id отказывается по-прежнему. Не изменились две строки: словарь `claudeCodeEffortSchema`
остаётся словарём ОДНОГО вендора (какой словарь у codex — вопрос формы, открыт), и дверь письма
(`cli.ts`) проверяет `--effort` директивы им же, потому что адресат директивы в момент письма
неизвестен.

### A4. Парсер потока

`packages/agent-protocol/src/orchestrator/transcript.ts`. Схема `streamEvent` (строки 56-81) описывает
NDJSON `claude -p --output-format stream-json`:

- `type: system|assistant|user|result`, `subtype: init`;
- `session_id`, `model` — только на `system`/`init` (`sessionIdOf:180`, `modelOf:201`);
- `num_turns`, `duration_ms`, `total_cost_usd`, `usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}` — только на `result` (`runUsageOf:250`);
- `message.content[]` с блоками `text|thinking|tool_use|tool_result` (`blockLines:100`);
- шаг сессии = событие `type: "assistant"` (`isAssistantStep:296`).

Пять экспортов этого модуля — `renderStreamLine`, `sessionIdOf`, `modelOf`, `runUsageOf`,
`isAssistantStep` — это и есть **весь контракт «поток → факты о прогоне»**. Он же — естественная
граница интерфейса исполнителя.

### A5. Семантика лимитов

`packages/agent-protocol/src/orchestrator/quota.ts`. Три источника, все вендорские:

1. `rate_limit_event` с `rate_limit_info.{status,resetsAt,rateLimitType}` (строки 169-186);
2. точная проза `Claude AI usage limit reached|<epoch>` (`EXACT`, строка 191);
3. рыхлая проза `rate_limit_error|usage limit reached|rate limit exceeded` (`LOOSE`, строка 198).

Плюс `windowOf` (строка ~420): `rate_limit_event` со статусом `allowed` несёт `resetsAt` текущего
окна, и это то, чем контур узнаёт границу окна ДО отказа.

Это самое вендор-специфичное место во всём пакете: и имена полей, и три регулярки — про одного
исполнителя.

### A6. Признаки исхода и продолжение

- `packages/agent-protocol/src/orchestrator/continuation.ts` — `--resume <session id>` как способ
  продолжить, и счёт шагов из A4 как калибровка потолка;
- `packages/agent-protocol/src/cli.ts:7241-7290` — спавн: своя группа процессов, `stdio` обе трубы,
  `detached`, SIGTERM на разбор (`cli.ts:7499`);
- `LAUNCH_ENV` (`launch.ts:132`) — `AGENT_PROTOCOL_WORKER`, файл id сессии, `--await-input` в
  секундах, дедлайн аренды. **Это наше, не вендорское**, и переезжает без изменений.

Важно: id сессии приходит НЕ из аргументов, а из первой строки потока и пишется в файл, который
сессия читает сама (`transcript.ts:167-193`). Механизм kind-нейтральный — меняется только то, из
какого поля какого события берётся id.

### A7. Пробы `doctor`

- `packages/agent-protocol/src/cli.ts:4773-4800`, `probeHeadless`: `execFileSync(exec, ["-p", "Answer with the single word: ok"])`. **Флаг `-p` вшит в пробу.**
- `packages/agent-protocol/src/orchestrator/doctor.ts:232` — строки `agent: binary` / `agent: headless run`;
- `packages/agent-protocol/src/orchestrator/doctor.ts:276-281` — строка токена учётки, чей `detail`
  диктует ремонт словами `CLAUDE_CONFIG_DIR=<dir> claude login`;
- `packages/agent-protocol/src/orchestrator/tick.ts:189,490`, `orchestrator/auth.ts:254`,
  `orchestrator/init.ts:241-257`, `notify/notify.ts:160` — та же команда ремонта прозой ещё в
  четырёх местах.

Пять мест диктуют человеку одну вендорскую команду. Для второго kind это пять точек правки, и **это
самая недооценённая часть работы**: дверь, которая молчит, хуже отсутствующей, а дверь, которая
советует `claude login` человеку с Codex, — хуже молчащей.

### A8. Словарь `worker` в почте

`packages/agent-protocol/src/thread/message.ts:208-211` — `claude-code`, `claude-ai`, … Словарь
ОТКРЫТ по замыслу (строка 40), так что `codex` тут не ломает ничего.
`packages/agent-protocol/src/thread/index-doc.ts:125` — `RUN_WORKER = "claude-code"`: сужение при
разборе ленты, и оно **станет неверным** в смешанном контуре.
`packages/agent-protocol/src/cli.ts:4895` — догадка «id kind → имя бинаря» (`claude-code` → `claude`).

---

## B. Что стоит на тех же местах у Codex CLI

Источники: `openai/codex@main` (`codex-rs/…`, распакован из
`codeload.github.com/openai/codex/tar.gz/refs/heads/main`, версия npm-шима 0.149.0) и
`https://developers.openai.com/codex/{auth,noninteractive,developer-commands}.md`.

### B1. Headless-режим — это `codex exec`, не флаг

`codex exec [OPTIONS] [PROMPT]` (`codex-rs/exec/src/cli.rs:12-13`). Промпт — **позиционный
аргумент**, не значение флага.

**Ловушка первого порядка: `-p` у Codex — это `--profile`, а не «промпт»**
(`codex-rs/utils/cli/src/shared_options.rs:35`). Проба `probeHeadless` (A7), запущенная на `codex`
как есть, отдаст профиль по имени `Answer with…` — то есть не отказ, а неверный запуск.

### B2. Argv — сопоставление с A2

| наше (A2) | у Codex | источник |
| --- | --- | --- |
| `-p <prompt>` | позиционный `[PROMPT]` у `codex exec` | `exec/src/cli.rs:76-80` |
| `--output-format stream-json --verbose` | `--json` (алиас `--experimental-json`) — JSONL в stdout | `exec/src/cli.rs:59-66` |
| `--resume <id>` | подкоманда `codex exec resume <SESSION_ID>` либо `resume --last` | `codex/noninteractive.md` |
| `--model <m>` | `-m/--model` | `utils/cli/src/shared_options.rs:22` |
| `--effort <e>` | флага нет: `-c model_reasoning_effort=<…>` через общий `-c key=value` | `utils/cli/src/config_override.rs:30-32`; поле `reasoning_effort` — `protocol/src/protocol.rs:2070` |
| `--allowedTools <list>` | **прямого аналога нет.** Ближайшее — режим песочницы `-s/--sandbox read-only\|workspace-write\|danger-full-access` плюс `--add-dir` | `shared_options.rs:40,71`; `codex/noninteractive.md` |
| `--settings <json>` (зоны, `permissions.deny`) | **прямого аналога нет.** Ближайшее — execpolicy `.rules` (`--ignore-rules` их выключает) | `exec/src/cli.rs:43-45` |
| `--max-turns <n>` | **аналога не найдено** в `exec/src/cli.rs` | там же |

Отдельно, чего у нас нет и что понадобится: `--skip-git-repo-check` (Codex **отказывается работать
вне git-репозитория**, `exec/src/cli.rs:31-33`), `-C/--cd <DIR>`, `--ephemeral` (не писать rollout на
диск), `-o/--output-last-message`, `--output-schema`.

Три пустые клетки — `allowedTools`, `settings`/зоны и `max-turns` — это **не мелочь реализации, а
предмет решения**: дверь зон (`zones check`) и потолок шагов на claude-code держатся флагами, а на
codex их держать нечем. Пилот с `--sandbox read-only` этого не вскроет; боевая роль вскроет сразу.

### B3. Поток — сопоставление с A4

Схема событий JSONL: `codex-rs/exec/src/exec_events.rs:11-36`. Верхний уровень ключёван по `type`:
`thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.started`, `item.updated`,
`item.completed`, `error`.

| наш факт (A4) | откуда у Codex |
| --- | --- |
| id сессии (`system`/`init` → `session_id`) | `thread.started` → `thread_id` (`exec_events.rs:39-43`) — и он же аргумент `exec resume` |
| модель (`system`/`init` → `model`) | **в JSONL-событиях `exec` поля модели не найдено** — придётся брать из того, чем её задали, либо признать неизвестной |
| шаг сессии (`type: "assistant"`) | ближайшее — `item.completed` с `item.type: "agent_message"` (`exec_events.rs:104-108`); единицы РАЗНЫЕ, как `steps` уже разошлись с `num_turns` |
| `result.usage.*` | `turn.completed` → `usage.{input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens,reasoning_output_tokens}` (`exec_events.rs:49-72`) |
| `result.total_cost_usd`, `num_turns`, `duration_ms` | **этих полей в `turn.completed` нет.** Стоимость прогона Codex сам не считает |
| исход/ошибка | `turn.failed.error.message` и `error.message` (`exec_events.rs:53-56, 88-92`) |

Существенно: **stdout несёт JSONL, прогресс идёт в stderr** (`codex/noninteractive.md`). Наш
супервизор уже пишет обе трубы (`cli.ts:7255-7258`) — то есть тут менять нечего, кроме того, какую
трубу считать «потоком».

### B4. Лимиты — сопоставление с A5

Типы есть: `RateLimitSnapshot` с `primary`/`secondary` окнами, где `RateLimitWindow` —
`{used_percent, window_minutes, resets_at}` (эпоха, секунды), плюс `rate_limit_reached_type` из
закрытого списка (`rate_limit_reached`, `workspace_owner_credits_depleted`, …) и `plan_type`
(`codex-rs/protocol/src/protocol.rs:2167-2222`).

**Но** едут они на `TokenCountEvent` внутреннего протокола, а среди восьми типов JSONL-событий
`codex exec` (B3) события лимитов НЕТ. То есть по потоку `exec --json` шельф окна (A5, `windowOf`)
строить пока нечем; чем это заменить — открытый вопрос к реализации, и его дешевле закрыть один раз
пробой на живом ключе, чем угадывать. `--json` даёт `turn.failed.error.message` — то есть у Codex
доступна рыхлая форма (прозой), а структурированная и превентивная — нет.

Это ровно то, о чём говорит постановка: «gate 019 должен уметь per-kind». Уметь придётся не только
другие числа, но и **другую полноту сигнала**.

### B5. Учётки и аутентификация

Способов пять, и headless из них работают не все.

| способ | команда | headless? | источник |
| --- | --- | --- | --- |
| подписка ChatGPT | `codex login` → **браузер** | нет | `codex/auth.md` |
| API-ключ | `printenv OPENAI_API_KEY \| codex login --with-api-key` (ключ через stdin) | **да** | `codex/auth.md` |
| API-ключ разово | `CODEX_API_KEY=<key> codex exec …` | **да** | `codex/noninteractive.md` |
| Codex access token (ChatGPT Enterprise) | `printenv CODEX_ACCESS_TOKEN \| codex login --with-access-token` | да, но нужен Enterprise-воркспейс | `codex/auth.md` |
| workload identity federation | среда выдаёт короткоживущие токены | да, для CI/облака | `codex/auth.md` |

Каталог учётки — **`CODEX_HOME`** (по умолчанию `~/.codex`; `$CODEX_HOME/config.toml`,
`$CODEX_HOME/auth.json`); `--ignore-user-config` не читает конфиг, но **auth всё равно берёт из
`CODEX_HOME`** (`exec/src/cli.rs:39-41`). То есть наша модель «учётка = каталог» (A1,
`localAccountSchema.configDir`) переносится один в один — меняется ровно имя переменной, и это
подтверждает, что имя надо снять с хардкода в свойство kind'а.

Проверка и выход: `codex login status` (код возврата `0`, когда учётные данные есть — прямой аналог
нашей строки `account: … token` в `doctor`), `codex logout`.

Про подписочный путь на безголовой машине документация говорит прямо: положить `auth.json` из
защищённого хранилища, дать Codex обновлять его на месте и сохранять между прогонами; и —
дословно — «не используйте этот путь для публичных или open-source репозиториев»
(`codex/noninteractive.md`, раздел ChatGPT-managed auth in CI/CD).

---

## C. Инструкция ноутного захода john (шаг 4 постановки)

**Рекомендация: API-ключ.** Обоснование, а не вкус: это единственный способ, который (а) работает
headless без браузера на боксе, (б) выдаётся и отзывается самим john в один заход, (в) не требует
Enterprise-воркспейса. Подписочный путь потребовал бы возить `auth.json` с ноутбука на бокс и
поддерживать его обновление между прогонами — то есть НЕ один заход, а постоянную обязанность
человека, что прямо противоречит рамке «его действий — минимум».

Заход john, пять шагов:

1. Открыть <https://platform.openai.com/api-keys>, создать ключ. Проект/организация — те же, где
   john хочет видеть расход;
2. Ключ **не пересылать в чат и не класть в тред**. Положить на бокс (hetzner) в файл секретов, тем
   же способом, каким на боксе уже лежат секреты транспорта — путь к нему машина знает полем
   `secrets.envFile` (`config/local.ts:97-100`);
3. Строка в этом файле: `CODEX_API_KEY=<ключ>`;
4. Сказать в тред одно слово: ключ положен. Значение — никогда;
5. Всё остальное — контур: `config set agent codex --exec <path>`, `doctor`, пилот.

**Про деньги — граница, и её проводит john, не я.** Оплата ключом идёт по тарифам API
(usage-based), а не из кредитов подписки ChatGPT: «When you sign in with an API key, Codex uses
standard API pricing instead of included ChatGPT plan credits» (`codex/auth.md`). Конкретных цен и
минимального тарифа этот документ не называет: цены — предмет решения john по
<https://openai.com/api/pricing/> на момент выдачи ключа, и называть их здесь числом, снятым не в
тот день, было бы хуже, чем не называть. Потолок расхода john ставит на стороне платформы (spend
limits) — контуру этот рычаг не принадлежит.

Если john предпочтёт подписочный путь (свой лимит вместо счёта за API) — это его слово, и тогда
заход другой: `codex login` на ноутбуке, перенос `auth.json` в `CODEX_HOME` на боксе и обязанность
сохранять обновлённый файл между прогонами. Оговорка документации про публичные репозитории
относится к CI-раннерам; наш бокс — не он, но обязанность возить файл остаётся.

---

## D. Что из этого следует для шага 2 (интерфейс исполнителя)

Опись даёт границу сама. Kind — это, по фактам A и B, ровно семь свойств:

1. **как назвать бинарь и его учётку**: `exec` + имя env-переменной каталога учётки
   (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`) — снять с хардкода A1;
2. **как собрать argv** из промпта, инструментов, зон, потолка шагов, модели, effort и продолжения —
   `buildLaunchArgv` становится методом kind'а;
3. **какая труба несёт поток** (stdout у обоих, но у Codex прогресс в stderr);
4. **как из строки потока достать** id сессии, модель, шаг, экономику — пять функций A4;
5. **как из строки потока достать сигнал лимита** — и **уметь ответить «нечем»**, что и есть случай
   Codex (B4). Молчаливое «лимитов не бывает» тут — дефект;
6. **как проверить бокс** (`doctor`): аргументы headless-пробы и **слова ремонта** — те самые пять
   мест A7;
7. **чего у kind'а нет**: `max-turns`, `allowedTools`, `--settings`-зоны у Codex (B2). Отсутствие
   должно быть НАЗВАНО в конфиге роли и отказывать по имени на двери, а не тихо не применяться.

Пункты 5 и 7 — не рефакторинг, а решения. Их стоит внести постановкой до кода, а не после.

## E. Замер 2026-08-23: карточка codex названа, а запуска из неё не выходит

Дополнение к D-7, снятое процессным тестом на настоящем CLI (`run.process.test.ts`, два кейса)
после того, как схема научилась принимать `launch.agent.kind: "codex"` (#74). Это ФАКТ прогона, а
не вывод из чтения кода:

1. `launch.allowedTools` в схеме **обязателен** (`launchSchema`, `.min(1)`), то есть любая роль,
   которую оркестратор вправе поднять, ПРОСИТ рычаг allowed-tools;
2. `allowed-tools` стоит в `cannot` у codex (#72), и дверь рычагов отказывает такой роли ПО ИМЕНИ
   раньше, чем строится argv: `role 'dev-core' would be raised as 'codex' … allowed-tools`;
3. роль БЕЗ секции `launch` оркестратором не поднимается вовсе — `no-launch-profile`, и путь флага
   (`--worker codex --model … --effort …`) упирается в тот же отказ.

Итог: **сегодня ни один путь не поднимает роль на codex** — ни карточка, ни флаг. Дверь отказывает
громко и по имени (это как раз то, ради чего писался #72), но обещание схемы из #74 остаётся
обещанием до ответа на вопрос B2/D-7: чем контур держит зоны и потолок шагов на инструменте, у
которого этих рычагов нет. Пока ответа нет, пилот (шаг 5 постановки) неисполним, и это стоит читать
как блокер треда, а не как дефект #74.

Оба кейса замера закреплены тестами — когда решение придёт, красным станет ровно тот из них,
который перестал быть правдой.

### E-2. Решение пришло 2026-08-24, и красным стал ровно тот кейс (протокол 20)

Слово john (тред `026`, вариант «а», ДЛЯ ПИЛОТА): роль-пилот на codex работает read-only, зоны
держит песочница/CI, а не рычаг. Что из этого стало кодом:

- `roles[].launch.agent` (член `codex`) получил **`toolsHeldBy: "sandbox-read-only"`** — одно слово,
  которым карточка НАЗЫВАЕТ, чем держится сессия. Пока слово не сказано, отказ `kindLeverRefusal`
  стоит как стоял: рычаги не «потеряны молчанием», их либо объявленно держит песочница, либо у роли
  их нет и её не поднимают;
- `roles[].launch.allowedTools` стал обязателен **условно по kind'у**: там, где рычаг у инструмента
  ЕСТЬ (claude-code), отказ схемы по имени сохранён дословно — дефект треда 012 (сессия, поднятая
  без права писать) не возвращается ценой удобства codex;
- утверждение проверяемо: `--sandbox read-only` стоит В ARGV запуска (`buildCodexArgv`), тем же
  токеном вендора, что и в пробе `doctor`. Карточка не «говорит про песочницу» — она её включает;
- словарь `effort` codex'а закрыт (`minimal, low, medium, high, xhigh`): `--effort max` — уровень
  ДРУГОГО вендора — теперь отказ со списком до траты аренды, а не мёртвый запуск;
- `max-turns` waiver'ом НЕ снимается: шаги снаружи прогона не считает никто, и роль с потолком на
  codex по-прежнему отказывает по имени.

Кейс 1 замера выше перестал быть правдой и переписан на положительный сценарий: карточка со словом
поднимается, argv несёт `--sandbox read-only`, `-m gpt-5-codex`, `-c model_reasoning_effort=minimal`
и НИ ОДНОГО флага соседнего инструмента. Кейс «та же карточка минус слово» остался отказом.

**Чего это по-прежнему не даёт: живого пилота.** Ни одна существующая роль этой правкой на codex не
переведена (форма не допускает включения молчанием), учётки codex на боксе нет, а карточка
роли-пилота — это `agent-protocol.json` и `docs/roles/**`, то есть кнопка john. Замер «codex принял
`model_reasoning_effort=minimal`» не сделан и сделан быть не может: на этом боксе нет ключа.

> **Поправка 2026-08-28 (тред `026`, протокол 21) — два утверждения выше опровергнуты живым
> прогоном, и запись оставлена как была ровно для того, чтобы это было видно.** Ключ на боксе
> появился, пилот поднялся, и перечень моделей вендора (`/home/lle/.codex/models_cache.json`,
> `codex-cli 0.150.1`) сказал: `minimal` не несёт ни одна модель, а `max` несут четыре из шести.
> То есть словарь, закрытый выше по ДОКЕ вендора, был неверен с обеих сторон, а «`--effort max` —
> уровень другого вендора» — неверно вовсе. Действующий список — `low, medium, high, xhigh, max`
> (`codexEffortSchema`), карточка пилота — `gpt-5.4-mini` + `low` (решение john 2026-08-28), а
> `gpt-5-codex` вендор под ChatGPT-аккаунтом не обслуживает вовсе (`400`, прогон `17:29:38Z`).
> Разбор — `docs/protocol-reference.md`, «Список codex'а исправлен 2026-08-28».
