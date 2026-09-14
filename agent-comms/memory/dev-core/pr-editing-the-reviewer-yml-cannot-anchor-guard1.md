---
name: pr-editing-the-reviewer-yml-cannot-anchor-guard1
description: "PR, правящий .github/workflows/claude-review.yml, круга ревью получить НЕ МОЖЕТ — метка сжигает круг вхолостую"
metadata: 
  node_type: memory
  type: project
  originSessionId: 095bce0e-bcaf-4b84-b3c9-8988362b19a0
  modified: 2026-09-14T14:21:48.408Z
---

PR, чей дифф трогает `.github/workflows/claude-review.yml`, вердикта автоматикой не получает
НИКОГДА, и метка на нём — сожжённый круг: `claude-code-action` пропускает себя, когда файл этого
воркфлоу в прогоне отличается от версии на дефолтной ветке (`claude-review.yml:708–711`), а на
событии `pull_request` в прогоне лежит файл MERGE-РЕФА, то есть версия самого PR. Обойти событием
нельзя: у `workflow_dispatch`/`issue_comment` самопропуска нет, но гард 1 требует
`run.event === "pull_request"` (`packages/agent-protocol/src/merge/gate.ts:949`).

**Why:** лекарство «подтяни `main` в ветку» из [[review-self-skips-on-a-stale-branch-too]] здесь не
работает ПО АРИФМЕТИКЕ, а не по невезению: расхождение блоба — это и есть предмет PR, слиянием оно
не снимается. Направление мерится `git diff origin/main:<yml> refs/pull/N/merge:<yml>` — одни
вставки PR значат «отставания нет, лечить нечего». Сам воркфлоу это говорит (`1204`): «если
воркфлоу правит сам этот PR — ревью человеческое», и (`1188`) «на самопропуске совет „перезапусти
метку“ ВРЕДЕН … автор платит вторым кругом ни за что».

**How to apply:** ДО метки грепни пути диффа на `claude-review.yml`. Есть — метку НЕ вешать, а
называть тупик вслух и нести вопрос к john через curator: гард 1 STOP плюс гард 4 «john merges
this one» держат такой PR закрытым для всех. Поле класса не видело (у #399, #302, #278 прогонов
ревьюера на голове нет ни одного) — вывод стои́т на тексте воркфлоу и коде гарда, и подаётся как
вывод. Ср. [[merge-gate-guard1-needs-review-workflow-name]], [[label-survives-force-push-and-mutes-the-lift]].
