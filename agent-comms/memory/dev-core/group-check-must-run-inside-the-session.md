---
name: group-check-must-run-inside-the-session
description: "Членство в группе проверять `id` ВНУТРИ поднятой сессии — `id -nG <user>` в ssh зелен по неверной причине."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6193c171-9850-40e5-aee0-979f9ce67465
  modified: 2026-09-03T09:57:39.628Z
---

Замер 2026-09-03 на ящике: `id` внутри поднятой сессии — `uid=1000(lle) groups=1000(lle),27(sudo),100(users)`,
а `id -nG lle` в ssh — `lle sudo users kvm docker contour`. Расходятся: демон поднят ДО `usermod -aG`,
а членство в группе на уже запущенный процесс не действует.

**Why:** любая приёмка групповой правки, снятая `id -nG <user>` из ssh, читает базу, а не среду,
в которой реально живут роли — то есть зелена по неверной причине. Тот же класс, что `docker` у раннеров.

**How to apply:** проверять `id` внутри поднятой сессии; после правки групп рестарт обоих демонов
обязателен, иначе правка не доедет до ролей. Родня: [[green-depends-on-where-the-checkout-lives]],
[[contour-ground-check-needs-tmp]].
