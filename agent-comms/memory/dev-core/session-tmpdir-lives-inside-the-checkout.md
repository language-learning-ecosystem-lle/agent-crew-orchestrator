---
name: session-tmpdir-lives-inside-the-checkout
description: "TMPDIR сессии — симлинк в .orchestrator/sessions внутри чекаута, поэтому mktemp -d стоит ВНУТРИ git-репозитория контура."
metadata: 
  node_type: memory
  type: project
  originSessionId: a3c79487-1439-4d29-9ec3-6682c6f68b02
  modified: 2026-09-11T14:24:15.066Z
---

`TMPDIR` поднятой сессии — это `/tmp/aco-<12 hex>`, симлинк на
`<чекаут>/.orchestrator/sessions/<прогон>.tmp` (алиас треда `070` поверх механизма треда `056`).
Значит `git -C "$(mktemp -d)" rev-parse --show-toplevel` печатает **корень контура**: всё
«временное» сессии стои́т внутри git-репозитория.

**Why:** это ломает любую проверку вида «этот каталог — не репозиторий» / «это чужое дерево» /
«где я стою», сделанную в `mktemp`-каталоге. Так родились 8 красных файлов сюиты на боксе при
зелёном CI (тред `098`): одна причина, восемь мест, которые СПРАШИВАЮТ у git.

**«Внутри чекаута» ≠ «грязь»** (замерено 2026-09-07, тред `157`): этот каталог лежит под
`.orchestrator/`, а он **игнорируется**, и `git pull --ff-only` поверх игнорируемого пишет молча.
Дверь, отказывающая по одному `rev-parse --show-toplevel`, отказала бы на привычном пути КАЖДОЙ
роли; предикат аварии — «внутри чекаута И `git check-ignore` молчит».

**У этого есть ДВЕРЬ, и она отказывает по имени** (замер 2026-09-11, тред `187`): `pr open
--body-file` из `mktemp -d` без `-p /tmp` отказал — «the body file … lies inside the git checkout
… write it OUTSIDE any checkout: `mktemp -d -p /tmp` (with `-p /tmp` on purpose — a session's own
`TMPDIR` can itself be inside the checkout)». Ничего не создано, PR не открыт; лечится повтором
команды с телом в `/tmp`. У `new-message --body-file` тот же класс.

**How to apply:** нужен каталог вне репозитория — бери его явно (`TMPDIR=/tmp mktemp -d` или
`mktemp -d -p /tmp`), не полагайся на `os.tmpdir()`/`mktemp -d`. Для сюиты пакета это уже сделано
харнессом — `packages/agent-protocol/src/testing/tmp-base.ts` + `setupFiles` в `vitest.config.ts`.
Связано: [[local-suite-needs-short-tmpdir]], [[green-depends-on-where-the-checkout-lives]].
