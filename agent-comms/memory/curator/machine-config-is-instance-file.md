---
name: machine-config-is-instance-file
description: "Учётки этого контура объявлены в instances/hetzner.json, а local.json на ящике нет вовсе; супервизор бежит как lle и не видит внутрь /home/aco-devops"
metadata: 
  node_type: memory
  type: project
  originSessionId: 22059a72-f6dd-4e0c-8a44-c7c900ff9af4
  modified: 2026-09-02T19:04:31.543Z
---

Машинная половина конфига этого контура — `~/.config/agent-protocol/instances/hetzner.json`
(демон поднят как `agent-protocol@hetzner.service`; соседний контур — `lle-hetzner.json`).
**`~/.config/agent-protocol/local.json` на ящике не существует** — ссылаться на него в постановке
значит послать john не по адресу. На 2026-09-02 файл объявляет `lle-main`, `lle-second`,
`codex-main`; `devops-main` в нём нет.

Второй факт того же замера: супервизор бежит из-под `lle`, а `/home/aco-devops` — `0750
aco-devops:aco-devops`, и `lle` в этой группе нет. **Всё, что супервизор судит по `stat`, о
каталогах роли под `systemUser` слепо**, и слепота приходит как `EACCES`, а не как «нет пути».

**Why:** репозиторий называет только ИМЯ учётки (`roles[].launch.account`), путь живёт на ящике —
и обе половины правки идут разными руками: файл ящика — john, имя — PR к его же кнопке (док власти).
**How to apply:** прежде чем писать «заведи учётку в конфиге», замерить `ls ~/.config/agent-protocol/instances/`
и `systemctl --user list-units | grep agent-protocol`, и назвать в постановке ИМЕННО тот файл, что
читает живой демон. См. [[merged-code-is-not-running-code]], [[system-user-role-cannot-read-shared-account]].
