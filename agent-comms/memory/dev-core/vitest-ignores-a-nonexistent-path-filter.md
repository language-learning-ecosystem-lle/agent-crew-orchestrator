---
name: vitest-ignores-a-nonexistent-path-filter
description: vitest на несуществующий путь в фильтре не ругается — «3 файла зелено» тихо становится двумя; сверять ЧИСЛО файлов с перечнем.
metadata: 
  node_type: memory
  type: reference
  originSessionId: aff04a9c-93fc-4e59-a915-0d7b3501fbbf
  modified: 2026-09-05T16:50:57.160Z
---

`vitest run --root … a.test.ts b.test.ts c.test.ts` с ОШИБОЧНЫМ путём одного из файлов не отказывает
и не предупреждает: он молча гоняет остальные и печатает `Test Files 2 passed (2)`.

**Why:** curator так потеряла треть замера (`sources.test.ts` лежит в `src/`, а не в
`src/orchestrator/`), и «3 файла зелено» стало неправдой при зелёном выводе.

**How to apply:** читать не слово `passed`, а ЧИСЛО файлов и сверять его с длиной своего перечня.
Тот же класс, что [[new-test-must-be-proven-by-mutation]] и [[probe-copy-pollutes-the-full-suite]]:
инструмент соглашается молча, ловится только арифметикой.
