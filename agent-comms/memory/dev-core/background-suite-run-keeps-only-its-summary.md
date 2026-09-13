---
name: background-suite-run-keeps-only-its-summary
description: "Фоновый `vitest` через Bash(run_in_background) оставляет в файле задачи ТОЛЬКО сводку — имя упавшего файла теряется; спасает свой `> /tmp/<лог>` в той же команде."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c93921f5-01a4-4ef5-a1f5-03c21060566d
  modified: 2026-09-13T18:16:23.648Z
---

Полный прогон сюиты, запущенный фоном (`run_in_background: true`), пишет в файл задачи не поток
репортёра, а его хвост: после «1 failed | 241 passed» в файле НЕТ ни строки `FAIL`, ни имени файла,
ни ассерта — `grep -a` по нему пуст. Узнать, ЧТО упало, уже нечем, и перемер стоит полного прогона
(здесь — 7 минут такта).

**Why:** сводка — это то, что репортёр печатает последним, а буфер задачи хранит хвост; всё
интересное (строки `FAIL`/`×`/диффы ассертов) печатается ДО неё и вытесняется.

**How to apply:** фоновый прогон сюиты запускать со СВОИМ перенаправлением в той же команде —
`TMPDIR=/tmp npx vitest run --root packages/agent-protocol > /tmp/aco-suite.log 2>&1; echo "rc=$?"
>> /tmp/aco-suite.log` — и ждать его `until grep -qa "Test Files" /tmp/aco-suite.log; do sleep 10;
done` (ожидание СВОЕЙ работы ход не нарушает). Тогда упавший файл называется, а `rc` отделяет
«сюита красная» от «прогон не состоялся» — сам харнесс на красной сюите отчитался `exit code 0`, так
что его коду верить нельзя. Смежное: [[local-suite-needs-short-tmpdir]],
[[vitest-run-invocation-traps]], [[test-counts-must-be-remeasured]].
