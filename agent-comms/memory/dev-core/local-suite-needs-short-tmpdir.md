---
name: local-suite-needs-short-tmpdir
description: Процессные тесты падают с listen EINVAL под сессионным TMPDIR — прогонять с TMPDIR=/tmp.
metadata: 
  node_type: memory
  type: project
  originSessionId: 32771720-7b99-447e-a167-32dbbe439a37
  modified: 2026-08-31T01:41:24.713Z
---

Локальный прогон пакета вести с `TMPDIR=/tmp pnpm exec vitest run`. Под TMPDIR сессии
(`.orchestrator/sessions/<длинное-имя>.tmp`, заведён в #172) `notify.process.test.ts` падает
всеми 36 тестами с `Error: listen EINVAL … /tsx-1000/<pid>.pipe`; с `TMPDIR=/tmp` — 36/36
зелёных. Замерено 2026-08-31, тред 061. Вывод (не факт): предел длины пути unix-сокета ~108
байт. В CI невидимо — там TMPDIR короткий.

Отдельно и НЕ от диффа: `daemon.watchdog.process.test.ts` падает одним тестом
(`circuit watchdog OFF`) и на чистом `origin/main`, в изоляции. Прежде чем считать красный
своей регрессией — прогнать тот же файл на `origin/main`.

Связано: [[assert-must-not-read-the-wall-clock]], [[clock-shift-for-process-tests]].
