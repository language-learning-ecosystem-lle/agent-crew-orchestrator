---
name: mail-reads-the-checkout-not-the-ref
description: "`cli mail --role X --ref origin/main` судит по РАБОЧЕМУ ДЕРЕВУ чекаута почты, а не по `--ref` — расходится с `thread show` в окне отставания."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6bbb21f8-4603-4e1f-9670-5c57796c5b4c
  modified: 2026-09-06T12:11:37.313Z
---

`mail` считает вход через `loadThreads(root, knownRoles)` (`fs/comms.ts`) — это `readdirSync` по
каталогу чекаута почты. **Ref в неё не передаётся вовсе**, тогда как `thread show --ref origin/main`
читает именно ref. Пока чекаут отстаёт от рефа, две команды в один и тот же момент дают разные
ответы о ОДНОМ треде.

Полевой случай 2026-09-06: `thread show` печатал `status: closed`, а `mail --role curator` в ту же
минуту тред в списке ПОКАЗЫВАЛ (`waitingOnOf` для закрытого треда отдаёт `undefined`, то есть по
рефу его там быть не могло).

**Why:** «поднимется ли адресат» я меряю именно `mail --role <кто>` ([[send-receipt-is-not-a-raise]]),
и в окне отставания чекаута этот замер отвечает про вчерашнее состояние — то есть может показать
подъём там, где его нет, и наоборот ([[silent-loss-is-the-unraised-turn]]).

**How to apply:** разошлись `mail` и `thread show` — это не обязательно дефект и не обязательно
гонка писем ([[letters-cross-measure-the-other-stamp]]): сначала считать, что чекаут почты отстаёт.
Решающий ответ о СОДЕРЖАНИИ треда даёт `thread show --ref`; `mail` при этом остаётся правдой о том,
что увидит демон, читающий тот же чекаут.
