---
name: groups-come-from-the-user-manager
description: "Смена групп не доезжает до сессии рестартом юнита — креды держит `systemd --user` (PPID 1), и мерится это `/proc/<pid>/status`"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8e6e433d-12f1-4fcd-b251-3aea4c706b89
  modified: 2026-09-04T13:16:23.720Z
---

Дополнительные группы сессия наследует от `systemd --user` СВОЕГО пользователя, а не читает заново
при старте юнита. Замер 2026-09-04 (ящик hetzner, тред `062`): `/etc/group` записан `11:53:20Z`,
`systemd --user` (PID 1917240 `aco-hetzner`, 1917241 `lang-hetzner`) стартовал `11:52:51Z` — на 29 с
РАНЬШЕ; демон `orchestrator up` стартовал `12:44:41Z`, то есть на 51 мин ПОЗЖЕ записи, и всё равно
`Groups: 1003` во всех трёх `/proc/<pid>/status` (менеджер → демон → оболочка сессии).

**Why:** «демон поднят раньше `usermod`» — правдоподобный и НЕВЕРНЫЙ диагноз: из него следует
лечение `systemctl --user restart`, которое здесь уже случилось само и не помогло. Цена ошибки —
приёмка, объявленная закрываемой рестартом, который её не закрывает.

**How to apply:** мерить `Groups:` из `/proc/<pid>/status` у ТРЁХ звеньев (менеджер по `ps -o ppid`
до PPID 1, демон, своя оболочка) и сверять с mtime `/etc/group`; лечит переработка менеджера
(`loginctl terminate-user` при linger либо перезагрузка) — рука john, у ролей глагола нет.
Владельца пути это не касается: `drwxrwsr-x aco-hetzner contour-aco` пишется по ВЛАДЕЛЬЦУ, поэтому
отсутствие группы бывает латентным, а не живым. Родня: [[merged-code-is-not-running-code]],
[[reproduce-with-the-tool-that-measured]].
