---
name: name-grep-counts-comments-as-callers
description: "«Кто запускает этот скрипт» грепом по имени файла завышено: упоминание в КОММЕНТАРИИ неотличимо от вызова. Мерить вызовом (`new URL`/`bash <путь>`), а не именем."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7f5f128f-9d62-4193-ba28-3583840ab30e
  modified: 2026-09-04T17:20:45.570Z
---

Ответ на вопрос «входит ли эта сюита в `checks`» грепом `grep -rn "<имя>.sh" --include=*.ts --include=*.yml`
НЕ получается: попадание в комментарий читается как вызов.

**Why:** 2026-09-04, тред 127. Проверяя, какие шелл-сюиты `.github/scripts/**` вообще кем-то
поднимаются, греп по имени дал `comms-push.test.sh -> notifier-mute.process.test.ts,
review-delivery.process.test.ts` — то есть «заведена в CI». Оба попадания оказались одной строкой
КОММЕНТАРИЯ («WHY NOT LEFT MANUAL, THE WAY `comms-push.test.sh` DELIBERATELY IS»), вызова нет.
Реально исполняется только `review-delivery.test.sh` — через `new URL("../../../../.github/scripts/
review-delivery.test.sh", import.meta.url)` в `review-delivery.process.test.ts`. Не поднимаются никем:
`review-delivery.integration.sh`, `comms-derive.test.sh`, `comms-push.test.sh`.

**How to apply:** мерить ВЫЗОВ, а не имя — грепать форму запуска (`new URL(`, `bash .github/scripts/`,
`run:` в шаге воркфлоу), и глазами открыть строку-кандидат перед тем, как назвать её в докладе.
Отдельно: **отсутствие сюиты в CI здесь бывает ОБЪЯВЛЕННЫМ, а не забытым** — шапка каждой из трёх
ручных называет ручной прогон, а у `review-delivery.integration.sh` названа и причина («нужны
pnpm-воркспейс и `origin/main` рабочего дерева»). Поэтому «её забыли завести» — вывод, который надо
сперва проверить шапкой файла. Родственное про ложную арифметику греп-замера:
[[daemon-log-grep-needs-an-anchor]], [[coverage-claims-in-comments-must-be-grepped]],
[[foreign-home-measured-by-paths-not-role-names]].
