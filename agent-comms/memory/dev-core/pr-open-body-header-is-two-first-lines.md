---
name: pr-open-body-header-is-two-first-lines
description: "pr open отказывает, если `thread:`/`role:` не стоят ПЕРВЫМИ двумя строками тела — не «где-то в теле»"
metadata: 
  node_type: memory
  type: reference
  originSessionId: da8309b9-44dc-4bed-9d6a-c6da34224256
  modified: 2026-09-09T15:14:20.263Z
---

`pnpm protocol pr open --body-file <p>` читает `thread: NNN-slug` СТРОКОЙ 1 и `role: <id>` СТРОКОЙ 2.
Подпись в конце тела (как в коммите) дверь не видит: она отказывает по имени и `gh` не зовёт вовсе.
Тот же ридер — гард 3 `merge-gate`, так что форма одна на обе двери.

**Why:** тело PR естественно писать как прозу с подписью внизу — и это стоит лишнего вызова,
потому что отказ приходит уже после того, как файл написан.

**How to apply:** класть две строки в самое начало файла, пустая строка, дальше текст. Файл — в
`mktemp -d -p /tmp` ([[session-tmpdir-lives-inside-the-checkout]]), иначе вторая дверь откажет за
грязь в чекауте. `--ref` у команды обязателен.
