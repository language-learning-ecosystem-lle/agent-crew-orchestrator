---
name: env-u-gh-token-breaks-a-workflow-touching-push
description: "`env -u GH_TOKEN` перед push'ем, несущим правку `.github/workflows/**`, роняет его «Internal Server Error» — это отказ ПРАВ, переодетый в отказ сервера."
metadata: 
  node_type: memory
  type: project
  originSessionId: ef1d50ac-d93a-4926-b93e-73888efe88e0
  modified: 2026-09-15T09:28:32.856Z
---

`env -u GH_TOKEN` — инструмент ЧТЕНИЯ и замера ([[green-on-the-box-may-lean-on-the-box-token]]:
так меряют, не опирается ли зелень на токен ящика). **Перед `git push` его ставить нельзя**: без
`GH_TOKEN` git уходит к сохранённому кредиталу ящика (`/home/aco-hetzner/.config/gh/hosts.yml`), у
которого нет права на пути воркфлоу, и push, несущий правку `.github/workflows/**`, отказывает так:

```
! [remote rejected] HEAD -> <ветка> (Internal Server Error)
```

**Текст врёт о причине — это не сбой GitHub, а нехватка права `workflow`**, замаскированная в HTTP
500. Замер 2026-09-15 (тред `209`): два подряд `env -u GH_TOKEN git push` отказали так на слиянии,
принёсшем в ветку `claude-review.yml` из `#445`; тот же push БЕЗ `env -u` прошёл с первого раза
(`5f45c5f44..a97d7f74e`). Диффы без путей `.github/workflows/**` так не отказывают — потому ловушка
и не видна годами.

**Why:** «Internal Server Error» читается как флак и зовёт к ретраю — а ретрай отказывает ровно так
же, и такт уходит на диагностику сервера, которого не чинили. Хуже: отказ похож на потерянную
квитанцию ([[lost-push-receipt-is-reproducible-by-receive-pack]]), где ссылка ДВИНУЛАСЬ, а квитанция
умерла — тут наоборот.

**How to apply:** отказ push'а мерить ДВУМЯ шагами, в этом порядке. (1) Двинулась ли ссылка:
`git ls-remote origin <ветка>` — равна старому значению → квитанция не потеряна, push правда не
состоялся. (2) Снять `env -u GH_TOKEN` и повторить — прошло значит это были права, а не сервер.
Для push'а сессия ходит СВОИМ токеном; `env -u` оставлять только на замерах зелени.
Родня: [[mail-write-can-fail-once-and-succeed-on-retry]], [[account-is-spendable-only-if-credentials-are-readable]].
