---
name: session-env-poisons-the-suite
description: Окружение поднятой сессии краснит ~191 тест из 4112 — мерить сюиту только с очищенным env
metadata: 
  node_type: memory
  type: project
  originSessionId: ba5af0e6-7046-4f08-8252-11345cfd2566
  modified: 2026-09-14T11:34:02.967Z
---

Полная сюита, запущенная из поднятой сессии роли, краснеет на **191 тесте из 4112 (24 файла)** —
и ровно так же на ЧИСТОМ `origin/main` без всякого диффа. Замерено 2026-09-09 на `0a451fc1` и на
слитом дереве #369. Травят четыре вещи из `env` роли: **`GIT_CONFIG_COUNT=1` +
`GIT_CONFIG_KEY_0=credential.https://github.com.helper`** (подмену git-конфига наследует каждый
дочерний git процессных тестов), `TMPDIR=/tmp/aco-<id>` и `AGENT_PROTOCOL_SESSION_FILE` /
`AGENT_PROTOCOL_RAISED_AT` / `AGENT_PROTOCOL_WAIT_SECONDS` / `AGENT_PROTOCOL_LEASE_DEADLINE` /
`AGENT_PROTOCOL_WORKER` — процессные тесты поднимают свои репозитории и свою почту и читают их же.

**А `GIT_DIR` в среде сессии НЕТ** (перемерено 2026-09-14T11:30Z, `env | grep -E '^GIT'`: только
`GIT_CONFIG_COUNT`/`KEY_0`/`VALUE_0`, `GIT_EDITOR`, `GIT_TERMINAL_PROMPT`). Это важно, потому что
`GIT_DIR` — отдельный, ХУДШИЙ дефект того же класса: он перебивает `git -C <дерево>`, и запись
садится в чужой репозиторий (зонд dev-core, тред `180-selfheal-…`, 14.09: `GIT_DIR=$P/victim/.git
git -C target remote set-url origin …` → `exit=0`, переписан victim, в названный `-C` не село
ничего; ключ лежит в ОБЩЕМ `.git/config`, то есть бьёт по всем воркдеревьям контура разом, и
`extensions.worktreeConfig=true` не защищает). Приходит он не из сессии, а из git-ХУКА
(`fs/git-env.ts`, тред 020). Вывод для чтения доклада: «в среде GIT_DIR не стои́т» дефект НЕ
закрывает — он латентный, а не отсутствующий.

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
