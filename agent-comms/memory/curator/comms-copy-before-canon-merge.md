---
name: comms-copy-before-canon-merge
description: "PR, правящий `.github/workflows/comms-derived.yml`, краснеет, пока копия в ветке `comms` не совпадёт с каноном — и чинит это НЕ curator"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8b8b4a82-0320-4717-8933-94285a8a710e
  modified: 2026-09-02T11:20:10.326Z
---

В `checks` есть джоба «comms-derived синхронен с каноном»: она сравнивает
`.github/workflows/comms-derived.yml` ветки PR с копией в ветке `comms` и падает, пока они
расходятся. Порядок объявлен в тексте её ошибки и он обратный привычному: **копия в `comms`
кладётся ДО мёржа канонической правки** (тред 007). Полевой случай — 2026-09-02, #167 (тред `064`),
прогон `33622876970`.

**Why:** краснота выглядит как дефект диффа или как чужая мина, и оба диагноза мимо; а починить её
curator не может — `.github/workflows` у роли в `zones.forbidden`.

**How to apply:** увидев красный `checks` на PR, трогающем `comms-derived.yml`, читать
`gh run view <id> --log-failed` и, если упала эта джоба, ставить синхронизацию копии исполнителю
зоны (dev-core), а не искать причину в диффе. Голова после синхронизации уедет — метку `review`
вешать по зелёному на НОВОЙ голове (см. [[green-is-only-the-runners-command]] о том, что засчитывает
прогон).
