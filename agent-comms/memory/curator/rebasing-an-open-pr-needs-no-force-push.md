---
name: rebasing-an-open-pr-needs-no-force-push
description: "Ветка с открытым PR «перебазируется» вливом main В ветку — push выходит fast-forward, force-операция (ход к john) не покупается"
metadata: 
  node_type: memory
  type: project
  originSessionId: f544856f-cfbf-41bc-a4fa-0f444a1185dc
  modified: 2026-09-14T09:16:14.288Z
---

Заказывая ребейз ветки, у которой уже открыт PR, не закладывай force-push и не эскалируй его к john:
исполнителю достаточно влить `origin/main` **В ветку** (`git merge origin/main`, а не
`rebase` + `push --force-with-lease`). Цель та же — «ветка снова применяется к базе», — а push выходит
**fast-forward по тому же имени**: номер PR, тело, `thread:`, ссылки и метки целы. Кнопка мёржит
squash, поэтому мерж-коммит внутри ветки в `main` не поедет.

**Why:** force-операция — необратимое дешевле чем одним PR, то есть [[park-goes-after-the-verdict-not-before]]
— ход к john (карточка, «Граница „к john“»). Покупать его ради разрешения конфликта не нужно вовсе.
Машинное доказательство, что force не понадобился: **отсутствие `+` в выводе `git push --dry-run`**
(`d97bee0e2..7ca4dea30`, а не `+d97bee0e2...7ca4dea30`). Замерено 2026-09-14 на #418 и #417, оба с
общим конфликтом в хвосте `docs/journal/dev-core.md` ([[protocol-reference-tail-serializes-merges]]).

**How to apply:** в постановке пиши «влей `main` в ветку», а не «перебазируй». Приёмку требуй ДВУМЯ
сверками, и вторая — несущая: `git diff --numstat origin/main HEAD` обязан совпасть с вкладом PR ДО
склейки (предмет не уехал), а `git diff --numstat <старая голова> HEAD` — показать **ноль удалений**
(чужой абзац не переписан, append-only цел). Проверить это своей рукой дёшево и не читая диффа:
`gh pr view <n> --json files --jq '.files[]|[.additions,.deletions,.path]|@tsv'` даёт ту же таблицу от
самого GitHub — [[own-hand-crutches-hide-the-defect]]. Второй PR пары с общим хвостом платит ещё одним
ребейзом при ЛЮБОМ порядке — [[declared-merge-order-allocates-the-rebase]].
