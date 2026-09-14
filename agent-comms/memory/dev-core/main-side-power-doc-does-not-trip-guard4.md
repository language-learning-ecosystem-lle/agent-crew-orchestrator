---
name: main-side-power-doc-does-not-trip-guard4
description: "Влитый в ветку `main` мог тронуть док власти — в составе диффа PR его НЕТ, и гард 4 не краснеет"
metadata: 
  node_type: memory
  type: project
  originSessionId: e400ac4b-a042-4d69-949c-00a73ad7950b
  modified: 2026-09-14T09:52:34.484Z
---

Состав диффа PR трёхточечный: он считается от НОВОЙ базы слияния, а не от старой. Поэтому
после влития `origin/main` в ветку пути, которые правил САМ `main` (в т.ч. `.github/workflows/**`
и другие доки власти), в диффе PR не появляются — замерено 14.09 на #386: `main` нёс правку
`.github/workflows/claude-review.yml`, а `merge-gate` на голове слияния дал гард 4 `ok`,
«6 changed path(s), none of them a document of power».

**Why:** иначе перебазировка выглядит как «мой PR теперь трогает док власти → кнопка уехала к john»,
и её боятся делать; а тем же составом диффа судят ещё два механизма — самопропуск круга ревью и
ветка `NO_ROUND` в `ci-outcome.yml`, глушащая зов автору повесить метку.

**How to apply:** после влития `main` состав диффа не гадать, а прочитать: `merge-gate` печатает
число путей и вердикт гарда 4, `gh api /repos/.../pulls/<n>/files` — сами пути. Смотреть надо на
вклад ВЕТКИ, а `--numstat` против родителя-`main` даёт ровно его. Связано:
[[rebase-without-a-force-push]], [[contribution-patch-not-tree-diff-proves-a-merge]].
