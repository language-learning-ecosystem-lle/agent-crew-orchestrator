---
name: new-box-alarm-is-a-norm-without-a-schema-bump
description: "Новый класс коробочной тревоги — слово john как новый повод звонить, но бампа схемы он не стоит"
metadata: 
  node_type: memory
  type: project
  originSessionId: 068722db-2a5f-45ab-94cc-d980d83233b8
  modified: 2026-09-09T13:57:20.001Z
---

Добавление ключа в `BOX_ALARM_KINDS` (`packages/agent-protocol/src/notify/notify.ts:140`) —
**новый повод звонить, то есть норма и слово john** для гарда 3, — но **конфига и схемы оно НЕ
трогает**: слоты `notifications.templates` ключуются `NOTIFICATION_KINDS`
(`config/config.ts:151`), а тексты коробочных тревог свои у пакета (`BOX_ALARM_TEMPLATES`), и
это сделано ровно затем, чтобы новый класс не стоил «a protocol version and a migration in
every box in the field» (комментарий над `restatedPrefix`).

**Why:** два гарда легко склеить в один и позвать john дороже, чем нужно, либо наоборот принять
звонок как починку. Признаки РАЗНЫЕ: повод звонить — норма всегда; бамп схемы — только когда
дифф трогает ключи конфига.

**How to apply:** увидела в диффе новый класс тревоги — требуй слово john по гарду 3 и одновременно
проверяй, что конфига в диффе НЕТ; конфиг там означает уже другую кнопку ([[schema-version-bump-is-johns-button]]).
Смежное: [[norm-or-repair-is-read-in-the-diff]], [[digest-bell-is-read-from-the-courier-tail]].
