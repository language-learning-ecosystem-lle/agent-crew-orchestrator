---
name: aco-session-cannot-reach-lle-repo
description: "Токен сессии aco не видит репозиторий LLE — переезд пина оттуда не сделать, ни чтением, ни пушем."
metadata: 
  node_type: memory
  type: project
  originSessionId: d717924f-0292-4c23-8cfb-65a02100ad8f
  modified: 2026-08-31T03:02:19.434Z
---

`GH_TOKEN` сессий контура `agent-crew-orchestrator` — fine-grained PAT, выданный ТОЛЬКО на
`agent-crew-orchestrator`. Репозиторий-потребитель
`language-learning-ecosystem-lle/language-learning-ecosystem` из такой сессии недоступен вовсе:
`git ls-remote origin` и `git fetch` в его чекауте — `403 Write access to repository not granted`,
`gh pr view` — `Could not resolve to a Repository`. Замерено 2026-08-31 (тред `056`).

**Why:** постановки регулярно кончаются словами «затем пин в LLE», и это читается как работа
dev-core контура aco. Она ею не является: половина §5 упирается не в решение и не в код, а в
права токена, и обнаруживается это только попыткой.

**How to apply:** рез тега (`scripts/split-package.sh … --push`) делается здесь и доезжает до
origin нормально — упирается СЛЕДУЮЩИЙ шаг. Планируя такт «тег + пин», считай пин чужим ходом:
он идёт крю LLE через curator. Локальный чекаут `/home/lle/projects/language-learning-ecosystem`
не трогать — там живой контур со своими воркдеревьями ролей, грязное дерево = отказ запуска их
ролей (R17). См. [[release-tag-number-does-not-say-what-it-carries]].
