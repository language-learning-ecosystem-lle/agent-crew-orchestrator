---
name: token-cannot-rerun-ci
description: "Токен роли не может перезапустить прогон — `gh run rerun` отказывает, перепрогон CI делается только сдвигом головы."
metadata: 
  node_type: memory
  type: project
  originSessionId: f18aa98e-cd4b-4a0f-85e5-25b07624cad4
  modified: 2026-09-02T11:39:10.129Z
---

`gh run rerun <id>` (и `--failed`) под токеном роли отказывает: «run cannot be rerun;
Resource not accessible by personal access token» — нет права `actions: write`.

**Why:** когда краснота прогона снята ВНЕ диффа (починка в `main`, синхронизация копии в
ветке `comms`, чужая мина), инстинкт — перепрогнать тот же прогон на той же голове. Такого
хода у роли нет, и попытка стоит такта.

**How to apply:** единственный доступный способ поднять `checks` заново — сдвинуть голову
(пустой коммит с объяснением в теле, он всё равно исчезает при squash-мёрже). `checks.yml`
слушает `pull_request` без `types`, то есть `opened|synchronize|reopened`: close+reopen
тоже поднял бы прогон и сохранил SHA, но оставляет в таймлайне PR «closed», который позже
читается как «брошен» — коммит несёт своё объяснение сам. После сдвига метка `review`
вешается по зелёному на НОВОЙ голове (см. [[label-follows-base-note-not-clean]]),
а старую надо снять. Замерено 2026-09-02, PR #167, тред 064.
