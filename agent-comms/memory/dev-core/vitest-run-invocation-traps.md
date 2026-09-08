---
name: vitest-run-invocation-traps
description: "Два способа потерять прогон сюиты на пустом месте — снятый репортёр `basic` и уехавший cwd под `--root`."
metadata: 
  node_type: memory
  type: reference
  originSessionId: c7c3188c-4f4f-4844-84b6-1a61a354a67b
  modified: 2026-09-08T11:00:07.525Z
---

Локальный прогон падает ДО единого теста двумя способами, и оба выглядят как поломка репозитория:

- **`--reporter=basic` в vitest 4 больше нет.** Отдаёт `Startup Error: Failed to load custom Reporter from basic` и стену стектрейсов про `ERR_LOAD_URL`. Репортёр по умолчанию уже даёт `× <имя>` построчно и итог `Tests N failed | M passed` — грепается тем же, ради чего звали `basic`;
- **`--root packages/agent-protocol` считается ОТ cwd**, а cwd Bash переживает вызовы. Уехал в пакет — путь становится `packages/agent-protocol/packages/agent-protocol`, и vitest отвечает `No test files found, exiting with code 1`. Звать из корня чекаута явным `cd /…/.worktrees/<роль> &&`.

Второе не то же самое, что [[vitest-ignores-a-nonexistent-path-filter]]: там молча падает ЧИСЛО файлов при живом прогоне, здесь прогона нет вовсе. Остальная форма вызова — [[local-suite-needs-short-tmpdir]].
