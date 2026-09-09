---
name: session-env-poisons-the-suite
description: Окружение поднятой сессии краснит ~191 тест из 4112 — мерить сюиту только с очищенным env
metadata: 
  node_type: memory
  type: project
  originSessionId: ba5af0e6-7046-4f08-8252-11345cfd2566
  modified: 2026-09-09T23:10:02.400Z
---

Полная сюита, запущенная из поднятой сессии роли, краснеет на **191 тесте из 4112 (24 файла)** —
и ровно так же на ЧИСТОМ `origin/main` без всякого диффа. Замерено 2026-09-09 на `0a451fc1` и на
слитом дереве #369. Травят четыре вещи из `env` роли: **`GIT_CONFIG_COUNT=1` +
`GIT_CONFIG_KEY_0=credential.https://github.com.helper`** (подмену git-конфига наследует каждый
дочерний git процессных тестов), `TMPDIR=/tmp/aco-<id>` и `AGENT_PROTOCOL_SESSION_FILE` /
`AGENT_PROTOCOL_RAISED_AT` / `AGENT_PROTOCOL_WAIT_SECONDS` / `AGENT_PROTOCOL_LEASE_DEADLINE` /
`AGENT_PROTOCOL_WORKER` — процессные тесты поднимают свои репозитории и свою почту и читают их же.

**Why:** без очистки замер меряет инструмент, а не дерево, и «192 красных» выглядит находкой, которой
нет. Обратный промах дороже: снимешь `GIT_CONFIG_KEY_0`, забыв `GIT_CONFIG_COUNT`, — git умирает на
КАЖДОМ вызове (`missing config key`), и файл краснеет целиком (47/47), что читается как обвал.

**How to apply:** `cd <копия дерева> && env -u AGENT_PROTOCOL_RAISED_AT -u AGENT_PROTOCOL_WAIT_SECONDS
-u AGENT_PROTOCOL_LEASE_DEADLINE -u AGENT_PROTOCOL_WORKER -u AGENT_PROTOCOL_SESSION_FILE
-u GIT_CONFIG_KEY_0 -u GIT_CONFIG_VALUE_0 -u GIT_CONFIG_COUNT TMPDIR=$(mktemp -d -p /tmp)
npx vitest run` — три переменные GIT_CONFIG снимаются ВМЕСТЕ. Так слитое дерево дало
`5 failed | 4109 passed`: четыре — [[gitless-tree-copy-reddens-four-tests]], пятый — таймаут 5000 мс
у `merge/gate.process.test.ts` под параллельной нагрузкой (отдельно файл `47 passed` за 113 с).
Пятый красный перегоняй ОДИН, прежде чем звать дефектом ([[own-hand-crutches-hide-the-defect]],
[[reproduce-with-the-tool-that-measured]]). Нужно это на кнопке — [[base-move-note-answered-by-measure]].
