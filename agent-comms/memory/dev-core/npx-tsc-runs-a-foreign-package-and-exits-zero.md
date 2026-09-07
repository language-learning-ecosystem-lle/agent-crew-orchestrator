---
name: npx-tsc-runs-a-foreign-package-and-exits-zero
description: "`npx tsc` ставит постороннее одноимённое из npm, печатает «это не тот tsc» и выходит НУЛЁМ — типизация не проверялась"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2e20f129-8984-451b-923d-aa18585dc9dc
  modified: 2026-09-07T14:29:30.942Z
---

`npx tsc --noEmit -p packages/agent-protocol` в дереве без локального `node_modules` (например, в
свежем `git worktree add /tmp/...`) не падает и не ругается кодом: npm тянет из реестра пакет
`tsc@2.0.4` — не компилятор, а заглушку, — та печатает

```
This is not the tsc command you are looking for
```

и **выходит с кодом 0**. Замерено 2026-09-07 (тред 063). Молчаливая зелень: типизация не
проверялась вообще, а `echo "tsc exit: $?"` честно печатает `0`.

**Why:** имя `tsc` в npm занято посторонним пакетом, а `npx` при отсутствии локального бинаря молча
ставит его из реестра. Ошибка при этом уходит в stdout, а не в код возврата, — то есть ровно тот
класс, который дисциплина 4 зовёт дефектом: отказ, по которому нельзя понять, что чинить.

**How to apply:** звать компилятор ПУТЁМ, а не именем — `./node_modules/.bin/tsc --noEmit -p
packages/agent-protocol` (или `pnpm exec tsc`), и это же правило распространить на любой
инструмент, гоняемый из дерева без своих зависимостей. Признак подмены в выводе — строка
`npm warn exec The following package was not found and will be installed`. Дерево без
`node_modules` чинится симлинками на дерево роли, см.
[[schema-bump-breaks-own-cli-from-the-branch]]. Родня по классу «зелено, но ничего не мерилось»:
[[vitest-ignores-a-nonexistent-path-filter]], [[nonzero-probe-exit-means-check-did-not-happen]].
