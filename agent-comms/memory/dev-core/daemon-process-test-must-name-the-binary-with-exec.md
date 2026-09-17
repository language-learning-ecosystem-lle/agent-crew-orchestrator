---
name: daemon-process-test-must-name-the-binary-with-exec
description: "Процессный тест демона без --exec зелен в сессии роли и красен на раннере: preflight ищет 'claude' в PATH прогонщика и не стартует"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d9b669b1-3903-459a-9c20-cf183c8d9e7f
  modified: 2026-09-17T11:05:39.121Z
---

`preflight` пробует бинарь агента **ДО первого тика** и при неразрешённом пути печатает
`✗ agent: binary (claude-code): 'claude' (kind) not found in the child process PATH` и
`agent-protocol: preflight failed — not starting` — демон умирает, не дойдя до шага под
проверкой. Путь берётся из `--exec` → машинного конфига → вендорного имени в PATH.

`sandbox()` (`testing/process-sandbox.ts`) вычищает переменные контракта запуска, но PATH
вычистить НЕ МОЖЕТ — ребёнку нужны `node` и `git`. Значит PATH утекает всегда, а `claude`
в нём есть у поднятой сессии и нет на раннере: тест зелен локально и красен в CI.

Замерено 17.09.2026 на PR #461: пять процессных случаев уборки (`daemon.tidy-up.process.test.ts`)
зелены в сессии, красны на раннере — все пять одной строкой preflight, ни один не про бинарь.

**Почему:** соседние процессные тесты демона (`daemon.parallel`, `standstill-letter`,
`turn-taken`) все передают `--exec <stub.sh>` — это не про подъём, а про пробу. Стенд, не
назвавший путь, меряет PATH того, кто гоняет сюиту.

**Как применять:** любой процессный тест, поднимающий `orchestrator daemon`, даёт
`--exec <stub.sh>` (`#!/bin/sh\nexit 0\n`, `chmod 0755`) — даже когда подъёмов в контуре
нет вовсе (без `.orchestrator/enabled` бинарь не запускается ни разу). **Условие раннера
воспроизводится локально:** `ln -s $(which node) $TMP/bin/node` и
`env -i HOME=$HOME TMPDIR=/tmp PATH="$TMP/bin:/usr/local/bin:/usr/bin:/bin" node
node_modules/vitest/vitest.mjs run --root packages/agent-protocol <файл>` — `node` есть,
`claude` нет. Родня: [[suite-inherits-the-session-env]], [[local-suite-needs-short-tmpdir]],
[[vitest-run-invocation-traps]].
