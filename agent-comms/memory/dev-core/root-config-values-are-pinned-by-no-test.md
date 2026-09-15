---
name: root-config-values-are-pinned-by-no-test
description: Корневой agent-protocol.json читают ЧЕТЫРЕ теста, но `parallelism` не пиньет ни один — какая СТРОКА пиньется, меряется грепом, а не презумпцией
metadata: 
  node_type: memory
  type: project
  originSessionId: 9c38d0cf-181f-4bc7-b1de-954019be81c6
  modified: 2026-09-15T12:53:26.934Z
---

Корневой `agent-protocol.json` сюита ЧИТАЕТ — `parseProtocolConfig(readFileSync(CONFIG_PATH))` в
`roles/explicit-model.test.ts`, `roles/standing-address.test.ts`, `roles/reviewer-pr.test.ts`,
`roles/workflow-signatures.test.ts` (модели, стоячие адреса, строка ревьюера, проводка воркфлоу).
Но `parallelism` не читает ни один из них: 15 файлов с `pairsPerInstance` — это свои фикстуры
(`config({…})`) и ассерты на ТЕКСТ строки демона. Замерено 15.09 на правке потолка 3 → 5 (тред 211).

**Why:** значит зелёный `checks` судит правку корневого конфига ИЗБИРАТЕЛЬНО — по строке. Тронул
модель роли, стоячий адрес или строку ревьюера — сюита тебя судит и покраснеет; тронул
`parallelism` — не судит вовсе, и зелень доказывает только валидность JSON и общие двери схемы.
Сказать про свою правку «сюиту не краснит по построению» без грепа — угадать, а не измерить; в msg-002
треда 211 я сказал сильнее факта («корневой конфиг не читает ни один тест»), и ревьюер это поймал.

**How to apply:** перед правкой значения в корневом конфиге грепать ДВЕ кучи
([[changed-sentence-must-be-grepped-into-two-piles]]): (1) кто читает САМ корневой файл — `grep -rn
"agent-protocol\.json" --include='*.test.ts'`, и (2) пиньется ли в них ТВОЯ строка. Молчание обеих
куч само есть результат замера, его докладывают. Приёмка непиньуемой строки — две вещи рукой:
прогнать новое значение через `parseProtocolConfig` на ФАЙЛЕ ветки (ловит полудекларацию и
перевёрнутую пару), остальное — ПОЛЕМ после merge, строкой живого демона
([[dry-run-is-a-free-oracle-on-the-ceilings]]). Кнопка: Д-4 покрывает только `protocolVersion`,
любая другая строка корневого конфига — гард 4 и john.
