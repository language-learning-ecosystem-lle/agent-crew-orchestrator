---
name: schema-bump-breaks-own-cli-from-the-branch
description: "PR, поднимающий protocolVersion, ломает `pr open` и почту из чекаута роли — версионная дверь стои́т раньше них"
metadata: 
  node_type: memory
  type: project
  originSessionId: 499e86ac-cc6c-4b2e-9f62-99ac2e4589d2
  modified: 2026-09-07T13:28:14.198Z
---

Пока PR с бампом `protocolVersion` не влит, команды пакета, запущенные ИЗ рабочего дерева роли
(исходники уже пишут N+1) против `--ref origin/main` (конфиг ещё N), отказывают раньше своей работы:

```
agent-protocol: 'agent-protocol.json' at origin/main: the repository declares protocol version 25,
the package writes 26 — run 'agent-protocol schema migrate'
```

Замерено 2026-09-07 дважды: `pr open` и `new-message`. То есть автор миграции схемы теряет
собственную почту ровно на том такте, когда о ней надо доложить.

**Why:** версионный гейт стои́т ПЕРЕД делом команды и не различает «репозиторий отстал» и
«репозиторий отстал, потому что его поднимает этот же дифф».

**How to apply:** `pr open` — `--ref <своя ветка>` (там конфиг уже N+1 и сходится с пакетом);
почта — запушить работу и вернуть чекаут в detached на базу (`git checkout --detach <origin/main>`),
оттуда исходники версии N и дверь молчит. Обе обходки чистые, но обе — отступление от буквы
маршрута, и его называют в треде: [[prose-does-not-release-the-turn]],
[[green-depends-on-where-the-checkout-lives]].
