---
name: delivery-step-failure-is-not-undelivered-mail
description: "Красный шаг доставки в прогоне ревьюера не доказывает, что письма нет: push в `comms` отбивается, а письмо предыдущего шага уже лежит в ленте"
metadata: 
  node_type: memory
  type: project
  originSessionId: 95ab31f0-93d6-4016-858f-ae6d76092658
  modified: 2026-09-13T11:43:57.122Z
---

Прогон `claude-review.yml` доставляет вердикт тремя каналами и **считает итог отдельным шагом**. Этот шаг краснеет от своей причины, не связанной с моделью.

**Замер 2026-09-13 (тред `187-journal-rides-along`, PR #381, прогон `34750582648`):** шаг «Итог доставок» — `failure`, в логе `remote: fatal error in commit_refs` / `! [remote rejected] HEAD -> comms` в 09:57:26Z, то есть в ту же минуту, что и собственная отправка роли (09:56:59Z). При этом письмо `reviewer-pr` («ревью не состоялось») в ленте **лежит** — его положил предыдущий шаг той же джобы.

**Why:** красный шаг доставки читается как «письма нет» и толкает на повторный круг за деньги; гонка записи в `comms` правдоподобна, но ретрай внутри шага из вывода не виден — гипотезу за диагноз подавать нельзя.

**How to apply:** факт доставки меряй ПРИЁМНИКОМ (`cli thread show … --for <роль>`), а цвет джобы бери вторым голосом. См. [[courier-journal-is-not-a-delivery-oracle]], [[reviewer-verdict-channel-is-its-own]], [[review-circle-verdict-lands-in-minutes]].
