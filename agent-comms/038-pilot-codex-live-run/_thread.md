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
