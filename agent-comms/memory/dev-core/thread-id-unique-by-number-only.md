---
name: thread-id-unique-by-number-only
description: Уникальность id треда проверяется только по номеру NNN — слаг повторять можно.
metadata:
  type: reference
---

`threadNumberTaker` (`packages/agent-protocol/src/thread/write.ts`) ищет чужой тред с ТЕМ ЖЕ
номером; полный id проверяется только существованием каталога. Значит `076-main-red-alarm` и
`112-main-red-alarm` живут рядом законно.

**How to apply:** шаблон имени для серии однотипных тредов (сменяющие друг друга приёмники
уведомителя) не требует ни даты в слаге, ни правки двери — тот же слаг плюс следующий свободный
номер. Связано: [[silent-loss-is-the-unraised-turn]].
