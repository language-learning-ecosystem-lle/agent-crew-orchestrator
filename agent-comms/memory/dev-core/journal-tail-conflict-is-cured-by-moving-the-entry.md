---
name: journal-tail-conflict-is-cured-by-moving-the-entry
description: "Расхождение журнального PR с базой чаще всего идёт РОВНО по общему хвосту docs/journal/<role>.md — лечится переездом записи в файл, названный тредом, а не разрешением конфликта"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1f50a3b5-4a2d-4340-affd-5ce046e712a3
  modified: 2026-09-14T13:51:13.358Z
---

PR, открытый ДО того, как форма «файл на тред» села в `main` (#408, 14.09 `10:51:41Z`), несёт запись
append-ом в общий хвост `docs/journal/<role>.md`. Любой соседний журнальный PR ломает его о тот же
последний хунк: конфликтующий путь — ровно один, и это хвост (замерено на #412, тред `199`; тот же
класс до этого на #410/#411, тред `197`).

**Why:** разрешать конфликт в append-only файле бессмысленно — запись там вообще не должна лежать.
Переезд в `docs/journal/<role>/<NNN-slug>.md` и есть одновременно починка формы и снятие конфликта,
и он дешевле: merge `origin/main` в ветку после переезда проходит чисто, force-push не нужен, номер
PR цел.

**How to apply:** увидел `CONFLICTING` на своём журнальном PR — сперва `gh pr view --json files`;
один путь и это хвост → вынести добавленные строки (`git diff <merge-base> <head> -- <хвост>`),
`git restore --source=<merge-base> -- <хвост>`, положить тело в файл треда и доказать целость
`diff` тела против извлечённых строк, потом влить `main`. Связано: [[contribution-patch-not-tree-diff-proves-a-merge]],
[[rebase-without-a-force-push]].
