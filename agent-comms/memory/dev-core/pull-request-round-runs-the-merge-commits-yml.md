---
name: pull-request-round-runs-the-merge-commits-yml
description: "Прогон по событию pull_request исполняет .yml merge-коммита (то есть main), а не дерева ветки — отставание ветки правку воркфлоу не отменяет"
metadata: 
  node_type: memory
  type: project
  originSessionId: a5bec41f-e212-48f4-bedc-636503b33ac1
  modified: 2026-09-14T11:08:29.170Z
---

Правку `.github/workflows/*.yml`, севшую в `main`, понесёт ПЕРВЫЙ ЖЕ прогон события `pull_request`
на ЛЮБОМ PR — даже на ветке, отрезанной задолго до неё: GitHub берёт файл из merge-коммита (ветка ×
база), а не из дерева головы.

**Why:** ждать «пока ветки подтянут `main`» перед приёмкой правки воркфлоу — потерянный такт; и
наоборот, сломанный шаг накрывает все открытые PR немедленно.

**How to apply:** доказывается эхом тела шага в логе (Actions печатает `run:` построчно) против
дерева головы: `git show <head>:.github/workflows/x.yml | grep -c '<новая строка>'` → `0`, а
`gh run view <ID> --log | grep -a '<новая строка>'` → есть. Замер 14.09: круг `34834578877` на
голове `d78263fea` (13.09 18:06Z) напечатал детектор из #418, влитого 14.09 09:21Z.
Дополняет [[run-headsha-does-not-name-the-code-it-ran]]; про `ref: main` у вызываемых скриптов —
[[workflow-wiring-is-pinned-by-a-delivery-integration-suite]].
