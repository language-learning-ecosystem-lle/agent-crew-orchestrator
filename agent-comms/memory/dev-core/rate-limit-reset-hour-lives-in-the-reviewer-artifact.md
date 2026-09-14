---
name: rate-limit-reset-hour-lives-in-the-reviewer-artifact
description: "Час снятия лимита основной учётки называет только артефакт красного круга (resetsAt), список кругов отвечает лишь «закрыто ли сейчас»"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 722cc412-6ca5-4e6e-b4fe-8806ee42d57c
  modified: 2026-09-14T16:16:42.246Z
---

Красный круг ревью, переехавший на запасную учётку, несёт в артефакте
`reviewer-execution-primary.json` запись `type=rate_limit_event`:
`status: "rejected"`, `rateLimitType: "five_hour"`, `utilization: 1`, `resetsAt: <epoch>` —
и ту же секунду прозой («You've hit your session limit · resets …»). У запасной в
`claude-execution-output.json` того же круга — `status: "allowed"` с её утилизацией.
Там же `total_cost_usd` — цена одной попытки (замер 14.09: `0.709`).

Качается так: `gh run download <runId> -R <owner/repo> -D <dir>` (**`-R` обязателен**: без него
`gh` падает `fatal: not a git repository`, если cwd не репозиторий).

**Why:** `gh run list --workflow 'Claude PR Review'` показывает только границу серии — «зелёные до
15:25Z, дальше красные», то есть отвечает на «закрыто ли сейчас». На «до какого часа» не отвечает
ничто, кроме артефакта, а без этого часа цена ожидания угадывается, а не считается.

**How to apply:** прежде чем вешать/перевешивать `review` в окне красных кругов — достань `resetsAt`
из артефакта последнего красного. До этого часа метка покупает вердикт, который гард 1 принять не
может ([[migrated-review-round-is-always-red]]), то есть трата без шанса на якорь; после — обычный
круг. Ту же запись бери как доказательство НАСТОЯЩЕГО переезда (против ложного, что чинил #418).
Связано: [[failed-review-round-class-lives-in-the-artifact]], [[price-a-one-line-fix-by-running-it-on-the-future-input]].
