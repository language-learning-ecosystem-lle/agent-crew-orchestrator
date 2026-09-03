---
name: lost-delivery-receipt-orphans-the-verdict
description: "Красный круг при ДОСТАВЛЕННОМ вердикте: `gh pr comment` вернул 502 после записи — шаг итога красит джобу, и STOP говорят оба гарда, 1 и 2."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 36998e83-26d3-46f7-b4ab-4a4b9fc16597
  modified: 2026-09-03T23:55:30.144Z
---

Джоба `review` красная, а вердикт при этом лежит во всех трёх каналах — коммент в PR, формальный
review-статус, письмо в тред. Причина не в суждении и не в модели: `.github/workflows/claude-review.yml`
судит доставку коммента КОДОМ ВЫХОДА `gh pr comment` и только им. Сервер запись принял, ответ
потерялся (`non-200 OK status code: 502 Bad Gateway`), клиент вышел единицей → `delivery_mark comment
failed` → шаг «Итог доставок» вышел единицей → `conclusion: failure` у всей джобы.

**Цена — полный второй круг ревью**, потому что краснота бьёт по ДВУМ гардам сразу:
`STOP guard 2 · not green: review=FAILURE` и, что менее очевидно,
`STOP guard 1 · an approve is shown … but no round of review on this head produced it: no CLOSED round
… (completed/failure)` — якорь гарда 1 это УСПЕШНЫЙ закрытый круг, поэтому доставленный `approve`
становится сиротой.

Полевой случай 2026-09-03, PR #260, прогон `33817342342`: коммент id `5533463712` создан `23:29:40Z`
(`updated_at` = `created_at`), `502` напечатан `23:29:51Z`, review-статус `APPROVED` `23:29:55Z`.
**Комментов в PR ровно один** — значит POST был один, повтора не было, и «письмо доехало, расписка нет»
это замер, а не догадка.

**Why:** отличить «письмо не доехало» от «квитанция потерялась» по коду выхода нельзя, а разница стоит
круга. Двух комментов при этом не бывает, поэтому дубля бояться не нужно — бояться нужно ложного
`failed`.

**How to apply:** прежде чем платить вторым кругом, ПЕРЕЧИТАТЬ комменты PR
(`gh api repos/<owner>/<repo>/issues/<N>/comments --jq '.[] | {id, at:.created_at, first:(.body|split("\n")[0])}'`)
— первая строка вердикта `verdict: approve|needs-fixes` видна сразу. Если коммент на месте, суждение
доставлено и чинить в PR нечего. Но мержа это не открывает: гарды судят прогон, а не коммент, поэтому
единственный ход — **снять и повесить метку `review` заново** (голову двигать нельзя, она унесёт
зачтённый зелёный `checks`; `gh run rerun` роли отказан — [[token-cannot-rerun-ci]]). Перед новой
меткой база могла уехать: мерить [[label-follows-base-note-not-clean]]. Класс отличать от
[[failed-review-round-class-lives-in-the-artifact]] (там `verdict.md` не создан вовсе) и от
[[identical-red-letters-may-be-two-incidents]].
