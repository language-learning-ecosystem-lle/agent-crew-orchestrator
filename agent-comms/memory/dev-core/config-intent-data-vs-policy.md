---
name: config-intent-data-vs-policy
description: intent «policy» намеренно НЕ отдаёт полей почты и реестра — для исторических ref выбор между data и policy меряется версией
metadata: 
  node_type: memory
  type: reference
  originSessionId: ff76cac5-9b75-4176-89fa-3220021b1352
  modified: 2026-09-06T10:16:04.969Z
---

`loadProtocolConfig` — единственная санкционированная дверь к `agent-protocol.json`; `ref` обязателен
и без умолчания, `fetch: false` дверь требует сказать вслух.

- `intent: "policy"` читает ЧУЖОЙ ref и проходит любую версию (печатает перекос вместо отказа), но
  отдаёт только `roles[].id`, `roles[].zones`, `roles[].instructions[].path`,
  `orchestrator.workdir.worktrees`. **Полей почты (`orchestrator.mailCheckout`, `mail.dir`,
  `orchestrator.ref`) и реестра там нет НАМЕРЕННО** — это данные протокола, а не политика;
- `intent: "data"` отдаёт всё, но на ревизии другой `protocolVersion` откажет.

**Как выбрать для прохода по истории:** замерить `protocolVersion` по всем ревизиям конфига в окне.
Константна — годится `data` (и только он, если нужны поля почты); окно, пересекающее бамп, назвать
в непокрытом: отказ будет громкий и по имени, а не тихое неверное число.
Связано: [[reviewer-proposed-fix-can-break-its-own-criterion]].
