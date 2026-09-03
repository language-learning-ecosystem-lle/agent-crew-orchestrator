---
name: machine-config-is-instance-file
description: "Учётки этого контура объявлены в instances/hetzner.json, а local.json на ящике нет вовсе; тот же файл полем secrets.envFile отвечает, чей креды-файл СВОЙ; супервизор бежит как lle и не видит внутрь /home/aco-devops"
metadata: 
  node_type: memory
  type: project
  originSessionId: 22059a72-f6dd-4e0c-8a44-c7c900ff9af4
  modified: 2026-09-03T14:11:21.358Z
---

Машинная половина конфига этого контура — `~/.config/agent-protocol/instances/hetzner.json`
(демон поднят как `agent-protocol@hetzner.service`; соседний контур — `lle-hetzner.json`).
**`~/.config/agent-protocol/local.json` на ящике не существует** — ссылаться на него в постановке
значит послать john не по адресу. На 2026-09-02 файл объявляет `lle-main`, `lle-second`,
`codex-main`; `devops-main` в нём нет.

**Он же отвечает, какой файл секретов СВОЙ** (замер 2026-09-03, тред `092`): `GH_TOKEN` бывает не
подан в среду поднятой сессии вовсе (`gh auth login` тогда просит логина), а на полке лежат оба —
`secrets.aco.env` и `secrets.lle.env`. Чей какой, решается не именем, а полем `secrets.envFile` того
инстанса, чей `repo` совпадает с деревом прогона: `hetzner` → `repo: …/agent-crew-orchestrator` →
`secrets.aco.env`. Взять соседний (`lle-hetzner` → `secrets.lle.env`) — тот самый отказ из
[[statement-of-work-ends-at-the-tag]], и различие тут ЗАМЕРЯЕМОЕ, а не «по названию похоже».

Искать его В РЕПОЗИТОРИИ — потерянный такт: `.orchestrator/` в дереве держит только состояние
демона (`daemon-code.json`, `notify.state`, `journal.jsonl`, `memory/`), каталога `instances/` там
нет вовсе. Полка одна и она в `$HOME`. Подъём токена в свой такт — одной строкой:
`set -a; . /home/lle/.config/agent-protocol/secrets.aco.env; set +a` (замер 2026-09-03, тред `058`).

Второй факт того же замера: супервизор бежит из-под `lle`, а `/home/aco-devops` — `0750
aco-devops:aco-devops`, и `lle` в этой группе нет. **Всё, что супервизор судит по `stat`, о
каталогах роли под `systemUser` слепо**, и слепота приходит как `EACCES`, а не как «нет пути».

**Why:** репозиторий называет только ИМЯ учётки (`roles[].launch.account`), путь живёт на ящике —
и обе половины правки идут разными руками: файл ящика — john, имя — PR к его же кнопке (док власти).
**How to apply:** прежде чем писать «заведи учётку в конфиге», замерить `ls ~/.config/agent-protocol/instances/`
и `systemctl --user list-units | grep agent-protocol`, и назвать в постановке ИМЕННО тот файл, что
читает живой демон. См. [[merged-code-is-not-running-code]], [[system-user-role-cannot-read-shared-account]].
