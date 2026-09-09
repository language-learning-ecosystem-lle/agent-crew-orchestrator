---
name: suite-in-a-worktree-breaks-the-contour
description: "Прогон процессной сюиты в `git worktree` этого репозитория переписал `remote.origin.url` и остановил ВСЮ почту контура"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4e696ad1-115e-4a61-adf5-e8fe51effa99
  modified: 2026-09-09T17:24:27.256Z
---

Замер слитого дерева я выложила через `git worktree add --detach` на коммит-пробу — ради настоящего
`.git`, потому что в распакованном архиве четыре теста краснели на `fatal: not a git repository`.
Деревья делят ОДИН `.git/config`: после `pnpm exec vitest run` процессных файлов `origin` стал
`https://github.com/lle/repo`, и `cli thread show`/`new-message` упали кодом 128 «Repository not
found» — почта встала у ВСЕХ ролей, не только у меня (2026-09-09, тред 180).

**Why:** worktree — не песочница. Изоляцию даёт отсутствие общего `.git`, а не отдельный каталог;
копия из `git archive` изолирует, `git worktree` — нет.

**How to apply — форма замерена, и она снимает выбор «свой `.git` ИЛИ изоляция»:**
`git clone --shared --no-checkout <корень> .worktrees/acc-<тред>` + `git checkout --detach <коммит
слитого дерева>` (коммит делается `git commit-tree` из `merge-tree --write-tree`; объекты видны через
alternates). Свой `.git/config` — `origin` переписывать процессным тестам НЕ во что; настоящий `.git` —
четыре теста архивной копии зелены; объекты общие — `pnpm install --frozen-lockfile` 0,6 с из стора.
Замерено 2026-09-09 на #359: **234 файла / 4061 тест зелено, 243 с**, `git remote -v` контура после
прогона прежний. `.worktrees/` в `.gitignore` — главный чекаут не пачкается (R17); `/tmp` не годится,
процессные тесты краснеют дверью почвы. Убирается `rm -rf`, `git worktree remove` не нужен —
это клон, а не линкованное дерево ([[mutation-acceptance-runs-in-a-tmp-copy]],
[[acceptance-on-the-merged-tree-is-cheap]]). Если сюита всё же ушла в worktree: сразу после неё `git remote -v` и восстановление
`set-url origin https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator`,
контроль — `git fetch --quiet origin main`. Симптом со стороны почты выглядит как чужая авария:
дверь называет 128 и чужой URL, а не свою руку ([[own-hand-crutches-hide-the-defect]]).
