---
name: git-dir-in-env-overrides-dash-c
description: "Унаследованный GIT_DIR перебивает `git -C <путь>` — команда пишет в ЧУЖОЙ репозиторий, а -C молча игнорируется"
metadata: 
  node_type: memory
  type: reference
  originSessionId: fa8d0481-1fb8-41bf-86d6-f12f715b905e
  modified: 2026-09-14T11:08:56.161Z
---

`GIT_DIR` в окружении **сильнее `-C`**: `GIT_DIR=/x/.git git -C /target remote set-url origin URL`
записывает в `/x`, а `/target` остаётся нетронутым. Замерено зондом 14.09 (тред 180): `victim`
до — `https://ORIGINAL/victim.git`, после — `https://HIJACKED/x.git`; у `target` origin так и не
появился. Лечит `env -u GIT_DIR` (в коде пакета — `gitEnvOutsideHook()` из `fs/git-env.ts`).

**Почему это важно, а не мелочь:** `-C` ВЫГЛЯДИТ как изоляция и ею не является. Процессный тест,
который строит свой контур в `mktemp -d` и честно зовёт `git -C <temp>`, под унаследованным
`GIT_DIR` пишет в НАСТОЯЩИЙ репозиторий, и `remote.origin.url` живёт в ОБЩЕМ `.git/config`
(проверять `git config --show-origin --get`) — то есть один такой вызов перенаправляет почту всем
воркдеревьям и всем ролям контура сразу. `extensions.worktreeConfig=true` от этого НЕ защищает:
ключ всё равно садится в общий файл.

**Как применять:** увидел `git -C` в тесте или скрипте — это ещё не доказательство изоляции;
изоляция доказывается вычищенным окружением. Ищи виновных не по `remote.origin.url` (строка
может не встречаться вовсе), а по `"remote", "add"` / `"remote", "set-url"`.

Связано: [[probe-collapses-two-outcomes-into-rule-broken]], [[git-shim-in-a-process-test-hits-every-git]],
[[version-door-is-silent-in-the-protocols-own-contour]].
