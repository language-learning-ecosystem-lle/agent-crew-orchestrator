---
name: merging-main-into-a-branch-editing-the-same-step-needs-the-other-prs-pin
description: "Если влитая в main правка трогала ТОТ ЖЕ шаг .yml, целость автослияния доказывается прогоном пина ЧУЖОГО PR, а не только своего"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: cbbedc59-60d2-49fb-b0f3-c6381ef24833
  modified: 2026-09-14T09:46:04.027Z
---

Ветка правит шаг `limit` в `claude-review.yml`, и в `main` уже влит другой PR, правивший ТОТ ЖЕ шаг.
`git merge` сливает такой `.yml` АВТОМАТИЧЕСКИ (конфликтом вылезает только хвост журнала) — и
автослияние само по себе не доказывает, что обе правки уцелели: своя половина может быть цела, а
чужая — съедена или обессмыслена.

**Why:** пины двух PR лежат в РАЗНЫХ приборах и вынимают из `.yml` РАЗНОЕ. Замерено 2026-09-14 на
#417 против #418: `.github/scripts/review-delivery.integration.sh` вынимает ТЕЛО ШАГА и гоняет его
на подложных транскриптах (пин #417, 23 состояния), а `packages/agent-protocol/src/roles/reviewer-limit-detector.test.ts`
вынимает jq-ПРОГРАММУ регэкспом из того же файла (пин #418, 5 тестов). Свой пин зелен и на дереве,
где чужая правка потеряна.

**How to apply:** после влития `main` в ветку — `git show <влитый коммит> --stat`, и если он трогал
те же пути, найти и прогнать ЕГО тест тоже, назвав оба числа в отчёте. Дешёвая разведка ДО слияния —
`git merge-tree --write-tree <ветка> origin/main`: печатает конфликтующие пути, ничего не меняя в
дереве. См. [[commutative-merge-is-not-proof-nothing-was-eaten]] и
[[contribution-patch-not-tree-diff-proves-a-merge]] — там та же мысль про ДАННЫЕ, здесь про ПОВЕДЕНИЕ.
