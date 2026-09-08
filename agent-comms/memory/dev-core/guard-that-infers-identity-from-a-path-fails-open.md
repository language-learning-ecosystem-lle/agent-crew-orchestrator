---
name: guard-that-infers-identity-from-a-path-fails-open
description: "Дверь, опознающая «чьё это дерево» по ФОРМЕ пути, на незнакомой форме не отказывает, а пропускает — и пропускает зелёным."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 90ad7adb-4e7e-4e8e-aa98-ee18a113151a
  modified: 2026-09-08T16:07:45.553Z
---

`zones check --role-from-workspace` берёт роль из последнего сегмента пути (`workspaceRoleOf`). Не опознал — `cli.ts:15156` печатает `'…' is not a role workspace, the guard does not apply` и делает `return`, **а не `fail()`**. То есть отказ наружу: exit 0.

**Замерено 2026-09-08 мутацией ОДНОЙ переменной — формы пути**, команда и запрещённый путь те же:

| дерево | итог на `--paths docs/roles/dev-core.md` |
|---|---|
| `.worktrees/dev-core` | **exit 1**, `'dev-core' may not write these paths` |
| `.worktrees/dev-core-177-probe` | **exit 0**, `the guard does not apply` |

Стреляет на ЛЮБОМ дереве внутри `.worktrees/`, чьё имя не равно имени роли. Тихая ветка — именно та, где родитель В репозитории: из чекаута, чей родитель не репозиторий, та же команда отказывает громко (exit 2).

**Практическое:** правка раскладки рабочих мест (ключ «роль × тред» и любая другая) разоружает эту дверь, **не оставив в ней ни одного хунка диффа** — класс [[zero-hunk-consumer-can-still-break]]. Мерить дверь мутацией формы пути, а не тестами двери.

Смежное: [[documented-command-must-run-from-the-role-workplace]], [[new-test-must-be-proven-by-mutation]], [[nonzero-probe-exit-means-check-did-not-happen]].
