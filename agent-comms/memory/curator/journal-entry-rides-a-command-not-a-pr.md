---
name: journal-entry-rides-a-command-not-a-pr
description: "С 14.09 запись журнала роли кладётся командой `journal write` в ветку почты — без ветки, PR, круга и кнопки"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0bf873b5-b10d-4f0b-9bef-ade8c24650d8
  modified: 2026-09-14T15:46:03.082Z
---

Норма 206 (слово john 2026-09-14), код в `main` коммитом `958308d45`:

```
agent-protocol journal write --root <mail> --ref <ref> --thread <id> --from <role> --body-file <p> --write
```

Запись ложится в **ветку почты** по пути `<mail.dir>/journal/<role>/<thread>.md` — форма «файл на
тред» (#408) уцелела, сменилась только ветка. Второй вызов APPENDит; тот же текст дважды —
ОТКАЗ по имени. Старые записи в `docs/journal/**` ветки `main` НЕ переезжают и остаются верными.

**Why:** до 14.09 журнальная запись платила веткой, прогоном, кругом ревью, конфликтом на общем
хвосте, ребейзом и кнопкой — за абзац хроники; замер того утра: из девяти PR без метки ЧЕТЫРЕ были
чистыми журнальными записями.

**ТЕКСТ нормы ещё не в `main`:** карточки ролей и `PROTOCOL.md` едут открытым PR **#437** — это доки
власти, кнопка john. Пока он не смёржен, карточка curator по-прежнему называет домом записи
`docs/journal/<role>/<NNN-slug>.md`, и дверь `merge-gate` держит исключение на этих путях. Замерено
14.09: журнальный PR #438 (`docs/journal/curator/196-*.md`) прошёл гарды 1/2/4 и смёржен штатно уже
ПОСЛЕ того, как код команды лёг в `main`. Флаг двери берёт ЗНАЧЕНИЕ — `--journals docs/journal`;
голый `--journals` = `exit 2`, «was given nothing to name».

**Контрольное чтение — по пути С префиксом каталога почты** (замерено 14.09, первая попытка
отказала): команда печатает `wrote agent-comms/journal/<role>/<thread>.md`, и на ветке путь
именно такой — `git show origin/comms:agent-comms/journal/<role>/<thread>.md`. Без `agent-comms/`
git отвечает `fatal: path … exists, but not …`. Команда САМА ставит шапку
`# Журнал роли <role> — тред \`<NNN-slug>\`` поверх тела — в `--body-file` её не дублируй.

**How to apply:** никогда больше не отвечай «дом записи — попутный дифф следующего PR» и не жди PR,
чтобы записать находку: цена упала до нуля, пиши сразу своей рукой. В дифф PR журнальную запись
класть НЕ надо — постановке это говорится отдельной строкой. Отменяет прежние поводы ждать:
[[pr-tail-sweep-needs-the-owning-thread]], [[two-open-prs-of-one-thread-share-one-journal-file]],
[[protocol-reference-tail-serializes-merges]], [[carried-tail-items-rot]].
