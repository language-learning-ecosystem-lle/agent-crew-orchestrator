---
name: local-suite-needs-short-tmpdir
description: Процессные тесты падают с listen EINVAL под сессионным TMPDIR — прогонять с TMPDIR=/tmp.
metadata: 
  node_type: memory
  type: project
  originSessionId: 32771720-7b99-447e-a167-32dbbe439a37
  modified: 2026-09-04T01:54:53.573Z
---

Локальный прогон пакета вести с `TMPDIR=/tmp pnpm exec vitest run`. Под TMPDIR сессии
(`.orchestrator/sessions/<длинное-имя>.tmp`, заведён в #172) `notify.process.test.ts` падает
всеми 36 тестами с `Error: listen EINVAL … /tsx-1000/<pid>.pipe`; с `TMPDIR=/tmp` — 36/36
зелёных. Замерено 2026-08-31, тред 061. В CI невидимо — там TMPDIR короткий.

**2026-09-02, тред 070 — предел ИЗМЕРЕН, а не выведен:** путь unix-сокета в 108 символов
слушается, 109 даёт EINVAL; `tsx` добавляет 22 символа, значит бюджет `TMPDIR` — ровно 86
(86 работает, 87 падает). Переменная — ДЛИНА, а не место. Починка в PR #183: супервизор отдаёт
короткий симлинк `/tmp/aco-<12 hex>` на тот же каталог. Пока #183 не в `main` и демон не
перезапущен — обход `TMPDIR=/tmp` всё ещё нужен.

Отдельно и НЕ от диффа: `daemon.watchdog.process.test.ts:505` падает одним тестом
(`expected … to contain 'circuit watchdog OFF'`) и на чистом `origin/main`, в изоляции. Причина
замерена 2026-08-31: в окружении ящика УСТАНОВЛЕНА `HEALTHCHECKS_CIRCUIT_URL_HETZNER`, а тест
ждёт выключенного сторожа. Это класс «тест зависит от среды ящика», в CI невидим. Прежде чем
считать красный своей регрессией — прогнать тот же файл на `origin/main`.

**2026-09-03, тред 089 — второй класс ложной красноты полного прогона: `Test timed out in
5000ms`.** Прогон всех 198 файлов разом дал 3 падения (`daemon.priority`, `daemon.process`,
`quota-pause`) — все три поднимают настоящий демон и упёрлись в дефолтный 5-секундный таймаут
vitest под нагрузкой ящика. Те же три файла отдельным прогоном — 27/27 зелёных. Значит: красный
процессный тест с демоном в ПОЛНОМ прогоне перепроверять поодиночке, прежде чем считать
регрессией; в CI невидимо (раннер прогоняет с другим параллелизмом).

**2026-09-03, тред 097 — у этой красноты «5000ms» нашлась НАСТОЯЩАЯ причина, и она не нагрузка:
конфиг таймаута лежит в `packages/agent-protocol/vitest.config.ts` (`testTimeout: 60_000`), а
запуск ИЗ КОРНЯ репозитория его не берёт — там корневой конфиг с дефолтом vitest 5s.** Замер:
`npx vitest run packages/agent-protocol/src/merge/` из корня — 5 падений `Test timed out in
5000ms`; `npx vitest run --root packages/agent-protocol src/merge/` — 224/224 зелёных, тот же
дифф, та же машина. Полный прогон пакета так же: 204 файла, 3425 проверок, зелено.

Отсюда правило прогона: **`TMPDIR=/tmp npx vitest run --root packages/agent-protocol`** —
`--root` (или `cd` в пакет) обязателен, иначе поодиночке перепроверять придётся не аномалию, а
каждый процессный тест. Особенно важно, если правка ДОБАВИЛА ожидание в путь CLI (пауза между
запросами к `gh` и т.п.): такая правка сдвигает к 5s ВЕСЬ файл, и из корня это читается как
«я всё сломал».

**Оговорка про `pnpm test` (2026-09-03, тред 094): флаг `--root` ему НЕ передавать.** Скрипт пакета
уже `vitest run --root packages/agent-protocol`, и `pnpm test --root packages/agent-protocol`
удваивает путь — `No test files found, exiting with code 1` из
`.../packages/agent-protocol/packages/agent-protocol`. Это не краснота дерева, а мой лишний флаг.
Из корня репозитория правильно ровно `TMPDIR=/tmp pnpm test` (он же гоняет и transport-telegram),
а `--root` нужен только голому `npx vitest run`.

**То же удвоение даёт `pnpm --filter` (2026-09-04, тред 096):** `pnpm --filter agent-protocol exec
vitest run --root packages/agent-protocol <файлы>` → `No test files found` из
`.../packages/agent-protocol/packages/agent-protocol`. `--filter` УЖЕ входит в пакет, поэтому
`--root` там лишний ровно как в `pnpm test`. Правило одной фразой: `--root` ставится ТОЛЬКО когда
рабочий каталог — корень репозитория (`npx vitest run`); всё, что входит в пакет само (`pnpm test`,
`pnpm --filter … exec`, `cd` в пакет), берёт конфиг с `testTimeout: 60_000` без флага. Точечный
прогон файлов — `TMPDIR=/tmp pnpm --filter agent-protocol exec vitest run <пути от корня пакета>`.

Связано: [[assert-must-not-read-the-wall-clock]], [[clock-shift-for-process-tests]].
