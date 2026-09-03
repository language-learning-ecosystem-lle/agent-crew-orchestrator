---
name: git-identity-is-shared-across-contours
description: "`curator <curator@agents.invalid>` — одна личность в ОБОИХ контурах: атрибуция чужого чекаута по автору коммита невозможна, разводит только ОС-пользователь"
metadata: 
  node_type: memory
  type: project
  originSessionId: 24dc278e-6c34-451e-b4c6-1aae29126b73
  modified: 2026-09-03T19:17:57.783Z
---

Ветка `curator/*` в чекауте СОСЕДА не значит «наша роль пересекла границу»: у обоих контуров
роли коммитят под одной и той же git-личностью (`curator <curator@agents.invalid>`,
`dev-core@agents.invalid` и т.д.). Замер 2026-09-03: `curator/protocol-legacy-append` в
`/home/lle/projects/language-learning-ecosystem` — коммит `d91402cce`, автор `curator
<curator@agents.invalid>`, а чужим его называет ТОЛЬКО номер треда в заголовке (`тред 129` —
нумерация соседа, у нас `0xx`) и соседние коммиты (`#487`, «П-42»).

**Why:** мера 4 треда `062` (сторож постфактум, `contour-footprint.ts`) сама оговаривается «this is
the window of this run, **not proof of its authorship**» — это не осторожность формулировки, а точное
описание предела механизма. Полевой улов за 2026-09-03: 25 срабатываний, 23 такта из 173 (13 %), ВСЕ
до одного — работа соседнего контура в его собственном доме, ноль пересечений. Отсюда довод в пользу
меры 5 (разные ОС-пользователи): раз атрибуция постфактум по git невозможна в принципе, разводит
контуры только ОС.

**How to apply:** увидев `CONTOUR BOUNDARY` в `daemon.log`, не диагностируй по имени ветки — сверяй
номер треда в заголовке коммита и окно по часам. И не считай отсутствие таких строк доказательством
чистоты: их нет и когда сосед просто спал. Мера 4 переживает меру 5 — шаг 4 операции (`chown -R … :contour-lang`,
`chmod -R g+rwX`) биты «прочих» не трогает, а они открыты на чтение (`drwxrwsr-x` на `.git`,
`-rw-rw-r--` на `packed-refs`), так что чтение refs соседа сохраняется; отказные строки §5 плана
мерят ЗАПИСЬ (`touch … PROBE`), не чтение.

Смежное — [[merged-code-is-not-running-code]], [[vendor-sandbox-measures-for-free]],
[[reported-instance-is-a-sample]].
