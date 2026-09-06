---
name: mutation-probe-must-not-be-undone-by-checkout
description: "Снятие мутации через `git checkout -- <file>` стирает и свою НЕЗАКОММИЧЕННУЮ правку в том же файле."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2b8a4fa4-ed63-4df5-8a6c-fd90065e1d8e
  modified: 2026-09-06T17:01:45.650Z
---

Мутационную пробу ([[new-test-must-be-proven-by-mutation]]) делают в том же файле, где лежит
своя ещё не закоммиченная правка. `git checkout -- <файл>` откатывает файл к HEAD — то есть
снимает не мутацию, а ВСЁ, включая свою работу; команда молчит, `git status` показывает
чистоту, и потеря видна только перечитыванием.

**Why:** 2026-09-06, тред 150: `sed` снял `[--ref <ref>]` из `usage.ts` для пробы, `git checkout --`
вернул файл к HEAD и унёс вместе с мутацией добавленный блок комментария; спасло только то,
что правка была свежа в контексте.

**How to apply:** коммитить ДО пробы и снимать мутацию тем же `sed`/Edit обратно, либо снимать
снимок индексом (`git add` файла перед мутацией → `git checkout-index -f`). Правило шире:
`git checkout --` по пути со своей незакоммиченной работой — необратимое действие, а не
«восстановление». Родственное — [[backup-to-a-bare-tmp-path-restores-a-foreign-file]].
