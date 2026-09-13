---
name: merge-gate-guard1-needs-review-workflow-name
description: "Гард 1 в `merge-gate` даёт `you` вместо `ok`, пока не назвать `--review-workflow 'Claude PR Review'`."
metadata: 
  node_type: memory
  type: project
  originSessionId: f3a8d1d9-b0d8-4103-b1bc-7886f53abbbc
  modified: 2026-09-13T15:46:55.270Z
---

`pnpm protocol merge-gate --ref origin/main --pr N` без `--review-workflow '<имя>'` оставляет гард 1
(`approve on the current head`) в состоянии `you`, даже когда круг закрыт и approve настоящий: имя
воркфлоу ревьюера принадлежит проекту, не пакету, и дверь не берётся отличить approve об этой голове
от approve о дереве, которое сменил пуш посреди круга. В этом контуре имя — `Claude PR Review`;
с флагом гард отдаёт `ok` и печатает окно круга (`created_at…updated_at`), внутри которого лежит вердикт.

**Флагу нужен `name:` ИЗ ШАПКИ `.yml`, а не имя файла — и промах маскируется под «круга не было».**
2026-09-13, #383 (тред 188): дал `--review-workflow claude-review` по имени файла
`.github/workflows/claude-review.yml` — гард 1 отказал текстом `no round of 'claude-review' is
reported for 52742cd at all`, хотя круг `34760596401` был закрыт и вердикт `approve` лежал. С
`--review-workflow 'Claude PR Review'` тот же прогон в ту же минуту дал `ok` с окном круга. Отказ
двери по дисциплине 4 честный (называет, чего ей не хватает), но «круга не было» и «ты назвал не тот
воркфлоу» по её тексту НЕ различаются — при таком отказе первым делом сверять имя:
`head -1 .github/workflows/<файл>.yml`, либо `gh run list --commit <SHA> --json workflowName`.

**Промах повторяется, и причина схлопывания — в коде.** 2026-09-13, второй раз за день (#383, тред
188): дал `'Claude Review'` — тот же отказ `no round of 'Claude Review' is reported for accf715 at
all`, уже НА ОДОБРЕННОЙ голове с зелёными `review`+`checks`. Ветка —
`merge/gate.ts:915`: `reading.runs.filter(run => run.name === reading.workflow)`, и при
`named.length === 0` дверь печатает приговор голове с лекарством «re-label, or a push». Различить
причины она МОЖЕТ: `reading.runs` приходит из `actions/runs?head_sha=<head>` (`merge/gh.ts:290`) —
это ВСЕ прогоны головы, любых имён; на `accf715` она держала `Claude PR Review` и `checks` и не
назвала ни одного. Починка (назвать имена, что реально есть на голове) — там же, ветка одна; текущий
текст пиньит `gate.test.ts:818`.

**Why:** без флага исход двери читается как «ревью не подтверждено», и на это тратится лишний круг
или лишний вопрос в тред; с НЕВЕРНЫМ именем — ещё хуже: отказ выглядит как приговор голове и толкает
перевесить метку, то есть сжечь настоящий круг ревью против лимита учётки.
**How to apply:** зовёшь дверь перед кнопкой — зови с `--review-workflow 'Claude PR Review'`
(именно `name:`, не имя файла); руками то же самое проверяется
`gh api ".../actions/runs?head_sha=<SHA>"`. Увидел `no round of '<имя>' … at all` — СНАЧАЛА сверь
имя этим же вызовом, и только если голова круга правда не несёт, перевешивай метку: лекарство из
текста двери под промахом по имени ложно и стои́т настоящего круга.
Связано: [[red-main-checks-may-be-comms-sync]], [[token-cannot-rerun-ci]].
