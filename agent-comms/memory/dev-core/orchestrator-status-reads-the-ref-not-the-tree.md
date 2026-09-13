---
name: orchestrator-status-reads-the-ref-not-the-tree
description: "`orchestrator status` берёт конфиг ролей ИЗ REF — значит два вызова с разными `--ref` дают даровой оракул на правку `agent-protocol.json`"
metadata: 
  node_type: memory
  type: project
  originSessionId: eb07c12a-ee21-4b77-ac10-fb935ac06f02
  modified: 2026-09-13T09:36:02.298Z
---

`orchestrator status` печатает шапку «`--ref origin/main` … read from the working tree» — но из
рабочего дерева там прочитан только САМ REF (`orchestrator.ref`), а политика (роли, статусы,
`launch`) берётся из названного ref. Правка `agent-protocol.json` в рабочем дереве на вывод НЕ
влияет вовсе.

**Отсюда даровой оракул:** закоммитить правку в локальную ветку и позвать команду ДВАЖДЫ —
`--ref origin/main` и `--ref <своя-ветка>`, — разницу снять `diff`. Пуш не нужен, ветка может быть
локальной.

Замерено 2026-09-13 (PR #380, `pilot-codex` `active` → `paused`): одна строка конфига дала четыре
строки разницы — `scope: … every role of this instance` (роль исчезает), секции `launch resolution`
и `launch permissions` (строка роли пропадает), и `workspaces`, где дерево роли переходит в
«not any role's workspace — nothing here is claimed about it».

**Две ловушки вывода, обе замерены там же:**

- строка `instances:` (`hetzner (this box): … roles curator, dev-core, devops, pilot-codex`) от
  статуса НЕ зависит — её пишет демон в файл состояния инстанса. Читать её как «правка не
  приземлилась» — ошибка;
- волатильные строки (`written … (Ns ago)`, `pulled Ns ago`) шумят в `diff` — сравнивать
  срезом секций или отфильтровав их.

**How to apply:** когда постановка спрашивает «есть ли даровой оракул» на дифф в
`agent-protocol.json` — он есть, и выдумывать ничего не надо. Связано:
[[new-test-must-be-proven-by-mutation]] (то же по духу: правка обязана что-то СДВИНУТЬ в
наблюдаемом), [[file-revision-in-a-tree-is-identified-by-content]].
