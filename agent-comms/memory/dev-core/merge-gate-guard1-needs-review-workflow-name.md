---
name: merge-gate-guard1-needs-review-workflow-name
description: "Гард 1 в `merge-gate` даёт `you` вместо `ok`, пока не назвать `--review-workflow 'Claude PR Review'`."
metadata: 
  node_type: memory
  type: project
  originSessionId: f3a8d1d9-b0d8-4103-b1bc-7886f53abbbc
  modified: 2026-09-02T15:00:01.357Z
---

`pnpm protocol merge-gate --ref origin/main --pr N` без `--review-workflow '<имя>'` оставляет гард 1
(`approve on the current head`) в состоянии `you`, даже когда круг закрыт и approve настоящий: имя
воркфлоу ревьюера принадлежит проекту, не пакету, и дверь не берётся отличить approve об этой голове
от approve о дереве, которое сменил пуш посреди круга. В этом контуре имя — `Claude PR Review`;
с флагом гард отдаёт `ok` и печатает окно круга (`created_at…updated_at`), внутри которого лежит вердикт.

**Why:** без флага исход двери читается как «ревью не подтверждено», и на это тратится лишний круг
или лишний вопрос в тред.
**How to apply:** зовёшь дверь перед кнопкой — зови с `--review-workflow 'Claude PR Review'`;
руками то же самое проверяется `gh api ".../actions/runs?head_sha=<SHA>"`.
Связано: [[red-main-checks-may-be-comms-sync]], [[token-cannot-rerun-ci]].
