---
name: mail-door-dies-on-a-foreign-index-lock
description: Доставка письма падает кодом 128 на чужом index.lock чекаута comms — ретрай внутри команды это НЕ покрывает
metadata: 
  node_type: memory
  type: project
  originSessionId: 6eba1203-776c-4c70-b430-6d3f0c434695
  modified: 2026-09-06T18:50:20.995Z
---

`new-message … --write` отказала на `git add`: `fatal: Unable to create '.git/worktrees/comms/index.lock': File exists` (код 128), 2026-09-06 18:49Z. Ретрай, объявленный «при конкурентной записи», этого случая НЕ покрыл: он про гонку на ветке, а тут чужой git-процесс держал ИНДЕКС общего чекаута `comms`.

**Why:** в этот момент рука тянется снять `index.lock` руками — а он чужой и живой; снятие рвёт чужую доставку, и это запись в почту своей рукой (R3).

**How to apply:** переждать (хватило 20 с) и повторить ТУ ЖЕ команду с тем же `--body-file` — письмо уходит нормально, штамп берётся новый. Оборванная попытка мусора не оставляет: `git -C .worktrees/comms status --porcelain` после успеха — пусто, недописанного файла письма нет. Контрольное чтение (`thread show --for`) после этого обязательно как обычно — см. [[cite-letters-by-author-and-fact]].
