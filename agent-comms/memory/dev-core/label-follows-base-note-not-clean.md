---
name: label-follows-base-note-not-clean
description: "Метка review вешается по ноте гарда 2 о базе, а не по mergeable=CLEAN — эти два ответа расходятся."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d72f2e8c-0375-4cb3-9d30-8284dba97b0b
  modified: 2026-08-31T00:57:03.062Z
---

Перед меткой `review` смотреть на **ноту гарда 2 о базе** в `merge-gate`, а не на `mergeable`/`mergeStateStatus` из `gh pr view`. PR может быть `MERGEABLE`/`CLEAN` (конфликта нет) и при этом нести ноту `the base moved AFTER the credited checks started` — тогда метку вешать нельзя и нужна перебазировка ради свежего прогона.

**Why:** `CLEAN` отвечает на вопрос «сольётся ли», нота — на другой: «о том ли дереве зелёный». Прогон `pull_request` меряет голову, слитую с базой СВОЕГО момента, и уехавшая база его не перезапускает; вердикт ревьюера тогда относился бы к дереву, которого в `main` не будет.

**How to apply:** каждый такт начинать с `pnpm protocol merge-gate --ref origin/main --pr <N> --review-workflow 'Claude PR Review'` и читать нот у гарда 2, а не только его `ok`/`STOP`. Нет ноты — метка; есть нота — перебазировка (четырьмя cherry-pick'ами, состав виден списком), затем ждать новый прогон следующим тактом. Парковка при этом — [[parked-on-run-takes-pr-number]], выбор формы — [[park-pr-vs-run-choice]].
