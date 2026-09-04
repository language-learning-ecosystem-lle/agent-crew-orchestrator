---
name: config-dir-names-its-account-and-tier
description: Какой аккаунт вендора и какой тариф стоит за каталогом учётки — читается из $CLAUDE_CONFIG_DIR/.claude.json без единого вызова
metadata: 
  node_type: memory
  type: reference
  originSessionId: d177dd93-590a-426d-8eb6-8dd87491d2c4
  modified: 2026-09-04T11:46:56.778Z
---

`jq '.oauthAccount' $CLAUDE_CONFIG_DIR/.claude.json` отдаёт `accountUuid`, `emailAddress`,
`organizationUuid` и **`organizationRateLimitTier`** (`default_claude_max_20x` / `default_claude_max_5x`).
Секретов там нет — креды лежат отдельно, в `.credentials.json`, и его `subscriptionType` says
только `max`, тарифа НЕ различает.

**Why:** «на каком аккаунте сидит каталог» и «какой у него потолок» до этого мерились пересказом
человека или ценой подписки. Здесь это строка от вендора: два каталога с РАЗНЫМИ `accountUuid` —
доказательство, что учётки разведены по-настоящему, а одинаковые — что разведение косметическое.
`mtime` у `.credentials.json` датирует перелогин.

**How to apply:** приёмка перелогина/рокировки учёток закрывается тремя замерами и НЕ требует ждать
первой сессии роли: (1) `.claude.json` — аккаунт и тариф, (2) `doctor` — `account: '<имя>' token:
answered` живым headless-вызовом ИЗ того каталога (это ровно класс отказа `Not logged in`), (3)
[[transcript-dir-reveals-the-account]] — кто на нём поднимался. Транскрипт логин-прогона несёт
`ownerAccountUuid` СТАРОГО аккаунта: им проверяется, чем каталог был ДО входа.
Дальше — [[field-sample-criterion-yields-to-enumeration]].
