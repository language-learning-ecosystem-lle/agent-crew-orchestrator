---
name: daemon-reads-parallelism-once-at-startup
description: "`parallelism.*` демон читает ОДИН раз при старте (`cli.ts:13540`, до цикла), а не каждым тиком — потолок вступает в силу только с перезапуском"
metadata: 
  node_type: memory
  type: project
  originSessionId: 90b61e33-2524-4865-b6bf-0fbf769cc6b3
  modified: 2026-09-16T13:16:34.650Z
---

`const daemonConfig = configFrom(argv, undefined).config` стои́т в `orchestratorDaemonLoop`
**до** цикла (`cli.ts:13540`; `for (;;)` — `cli.ts:14444`). Оба потребителя внутри цикла
(`pairCeilings(daemonConfig)` на `cli.ts:14651` и `:14676`) читают замороженное значение.
Собственный комментарий над строкой говорит это прямо: «Read ONCE at startup… a config that
moved is a `git pull` away from the restart that re-reads it anyway».

**Why:** ходовая посылка «конфиг читается с ref каждым тиком» верна для почты и парков, но НЕ
для `parallelism`. Приёмка вида «первый тик после merge назовёт новое число» на ней разваливается:
без рестарта тик назовёт СТАРОЕ, и это документированное поведение, а не дефект. Замерено
2026-09-16, тред 211 (потолок 3 → 5): спас только самоперезапуск демона на merge-коммит.

**How to apply:** правишь `parallelism` (или что угодно из `configFrom` демона) — приёмка
начинается с вопроса «перезапускался ли демон после merge»: `.orchestrator/daemon-code.json`
и строки `daemon — code:` в `daemon.log` (см. [[daemon-log-dates-its-own-code]]). Правка ОДНОГО
`parallelism`, без кода и без бампа `protocolVersion`, самоперезапуск не поднимает ничем.
Что число живое — меряется `orchestrator status` (строка `parallelism: N of M place(s) live`),
не строкой отказа — см. [[ceiling-refusal-line-is-a-self-defeating-acceptance]].
