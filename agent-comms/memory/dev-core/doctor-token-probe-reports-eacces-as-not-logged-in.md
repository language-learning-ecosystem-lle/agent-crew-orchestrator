---
name: doctor-token-probe-reports-eacces-as-not-logged-in
description: "`doctor` строкой `account: <id> token:` печатает вендорское «Not logged in» и на каталоге, который ящик просто не может ПРОЧИТАТЬ"
metadata: 
  node_type: memory
  type: reference
  originSessionId: da8309b9-44dc-4bed-9d6a-c6da34224256
  modified: 2026-09-09T15:14:32.173Z
---

Замерено 09.09.2026 из сессии контура (`uid=aco-hetzner`): `doctor --instance hetzner` отвечает
`account: 'lle-second' token: Not logged in · Please run /login` — а настоящая причина в том, что
`/home/lle/.claude-lle-second/.credentials.json` этому пользователю не читается. Рядом
`codex-main` честно печатает `Permission denied`: строка зависит от того, ЧТО ответил бинарь
вендора, а не от прав.

**Why:** ремонт, который эта строка диктует, — логин, и он не чинит ничего: логин под ДРУГИМ
пользователем перепишет файл, который останется его же. Тот же класс стоил john двух ручных
логинов живой учётки (тред 047).

**How to apply:** увидев `Not logged in` у учётки, сначала померить права каталога и кредов из-под
того пользователя, которым поднимается роль, и только потом думать про токен. `existsSync`
зелен и на нечитаемом каталоге, поэтому «каталог есть» ничего не доказывает
([[account-is-spendable-only-if-credentials-are-readable]]).
