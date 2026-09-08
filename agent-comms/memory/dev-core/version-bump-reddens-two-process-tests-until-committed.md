---
name: version-bump-reddens-two-process-tests-until-committed
description: "Пока бамп `protocolVersion` не закоммичен, локальная сюита краснит `force-stop-delivery.process.test.ts` (2 теста) — дверь версии читает конфиг НА РЕФЕ `HEAD`, а не в рабочем дереве"
metadata: 
  node_type: memory
  type: project
  originSessionId: e5bccdb7-549e-4d79-b251-43562769c84d
  modified: 2026-09-08T19:32:00.788Z
---

Бампишь `CURRENT_PROTOCOL_VERSION` (`schema/version.ts`) и `protocolVersion` в
`agent-protocol.json` — **до коммита широкий локальный прогон обязан быть красным ровно в одном
файле**: `src/orchestrator/force-stop-delivery.process.test.ts`, оба теста
(«the config names the file → the token reaches the child `git`…» и «the file the config names is
not there → the refusal names the push…»).

Отказ дословно: `'agent-protocol.json' at HEAD: the repository declares protocol version 26, the
package writes 27`. Рабочее дерево уже несёт новое число, **а `HEAD` ещё старое** — дверь версии
читает конфиг РЕФОМ, и в окне «поправил, но не закоммитил» она права.

**Замерено 2026-09-08 (тред `177`, PR #348), тремя прогонами одной команды**
(`TMPDIR=/tmp npx vitest run --root packages/agent-protocol src/schema src/config src/orchestrator`):
дерево грязное на `ee960b86` → 144 файла, 2543 теста, **2 падения**; тот же контент, но
закоммиченный (`476442e5`) → **зелено, exit 0**; CI на той же голове → зелено. Воспроизведение
точное: `git checkout <branch-head> -- .` поверх `main` даёт те же два имени.

**Практическое:** увидев ровно эти два падения при бампе — не диагноз, а часы: коммить бамп и
перепрогонять. Судить о зелени пакета в окне бампа можно только по ЗАКОММИЧЕННОЙ голове. И не
объяснять это `origin/main`: ref в отказе — `HEAD`, гипотеза «локально есть `origin/main`, а в CI
его нет» этим замером не подтверждается. Класс —
[[suite-inherits-the-session-env]], [[green-depends-on-where-the-checkout-lives]].
