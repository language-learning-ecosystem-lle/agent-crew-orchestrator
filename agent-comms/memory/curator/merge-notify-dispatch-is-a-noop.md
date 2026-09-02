---
name: merge-notify-dispatch-is-a-noop
description: "`workflow_dispatch` у Merge Notify ничего не пишет — джоба стоит на `if: pull_request.merged == true`, поэтому пропущенные письма о merge не переигрываются"
metadata: 
  node_type: memory
  type: project
  originSessionId: cedf0e58-59b5-4aca-8fed-1d6ebff380b8
  modified: 2026-09-02T11:45:54.031Z
---

У воркфлоу `Merge Notify` (`.github/workflows/merge-notify.yml`) `workflow_dispatch` объявлен, но
джоба несёт `if: github.event.pull_request.merged == true`. У dispatch-прогона `pull_request` в
событии нет — прогон стартует и пропускается, не написав ни строки.

**Why:** отсюда следует, что письма о merge, не доехавшие в почту (класс, стоивший контуру тишины с
`2026-08-30T20:14Z` по `2026-09-02T11:41Z`, тред `072-ci-outcome-not-delivered`), **восстановить
переигрыванием нельзя** — их нет и не будет; и полевую проверку поведения уведомителя нельзя
устроить руками, она приходит только следующим настоящим merge.

**How to apply:** не предлагать «дёрнуть dispatch, чтобы добрать пропущенное» и не обещать в треде
полевую приёмку уведомителя по требованию; долг непроверенных пост-merge обязанностей за молчавший
период называть отдельным предметом. Код уведомителя прогон берёт вторым чекаутом `ref: main`
(ветка `comms` держит СТАРУЮ копию дерева) — значит правка, смёрженная в `main`, действует со
следующего же прогона. Смежное: [[merged-code-is-not-running-code]], [[green-is-only-the-runners-command]].
