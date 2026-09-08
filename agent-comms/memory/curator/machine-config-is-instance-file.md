---
name: machine-config-is-instance-file
description: "Учётки этого контура объявлены в instances/hetzner.json, а local.json на ящике нет вовсе; тильда в адресе — дом ТОГО, КТО БЕЖИТ (с 04.09 это aco-hetzner, не lle), и тот же файл полем secrets.envFile отвечает, чей креды-файл СВОЙ"
metadata: 
  node_type: memory
  type: project
  originSessionId: 22059a72-f6dd-4e0c-8a44-c7c900ff9af4
  modified: 2026-09-08T16:42:54.864Z
---

Машинная половина конфига этого контура — `~/.config/agent-protocol/instances/hetzner.json`
(демон поднят как `agent-protocol@hetzner.service`; соседний контур — `lle-hetzner.json`).

**ТИЛЬДА ЗДЕСЬ — ДОМ ТОГО, КТО БЕЖИТ, и с 04.09 это `aco-hetzner`, а не `lle`** (замер 2026-09-08,
тред `179`): `ps -eo user,args` называет демона `aco-hetzner … orchestrator up --instance hetzner`,
а адрес конфига строится от него — `config/local.ts:277`,
`env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config")`. Правящий файл —
**`/home/aco-hetzner/.config/agent-protocol/instances/hetzner.json`** (объявляет `lle-main`,
`lle-second`, `codex-main`, `devops-main`), а `/home/lle/.config/…/hetzner.json` из-под роли отвечает
`Permission denied` — то есть замер по буквальному `/home/lle/…` из чужого письма даёт отказ и
читается как «замер не сошёлся». Абзац ниже про супервизора-`lle` — состояние ДО разведения контуров
по пользователям 04.09.
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

Второй факт того же замера (**состояние 2026-09-03, ДО переезда демона на `aco-hetzner` — см. блок
выше**): супервизор бежал из-под `lle`, а `/home/aco-devops` — `0750
aco-devops:aco-devops`, и `lle` в этой группе нет. **Всё, что супервизор судит по `stat`, о
каталогах роли под `systemUser` слепо**, и слепота приходит как `EACCES`, а не как «нет пути».

**Why:** репозиторий называет только ИМЯ учётки (`roles[].launch.account`), путь живёт на ящике —
и обе половины правки идут разными руками: файл ящика — john, имя — PR к его же кнопке (док власти).
**How to apply:** прежде чем писать «заведи учётку в конфиге», замерить `ls ~/.config/agent-protocol/instances/`
и `systemctl --user list-units | grep agent-protocol`, и назвать в постановке ИМЕННО тот файл, что
читает живой демон. См. [[merged-code-is-not-running-code]], [[system-user-role-cannot-read-shared-account]].

**Из указателя (перенесено 2026-09-03, оглавление шло за потолок):** `local.json` на ящике нет вовсе, а супервизор бежит как `lle` и слепнет (`EACCES`) над каталогом роли под `systemUser`: замеряй адрес до постановки; и он же полем `secrets.envFile` у инстанса, чей `repo` = дерево прогона, отвечает, какой креды-файл СВОЙ, когда `GH_TOKEN` в среду сессии не подан

**Из указателя (перенесено 2026-09-06, оглавление шло за потолок):** адрес `~/.config/agent-protocol/instances/hetzner.json`, и его `secrets.envFile` называет свой креды-файл
