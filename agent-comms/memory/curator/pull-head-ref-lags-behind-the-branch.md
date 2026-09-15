---
name: pull-head-ref-lags-behind-the-branch
description: "`refs/pull/N/head` бывает ОТСТАВШИМ от головы ветки — дифф и блоб, взятые пулл-рефом, описывают дерево, которого на голове нет; оракул головы — `gh pr view --json headRefOid` или `refs/heads/<ветка>`"
metadata: 
  node_type: memory
  type: project
  originSessionId: e1a51b9d-05ff-46e0-abfe-5e4c7447eabf
  modified: 2026-09-15T09:54:26.843Z
---

Зеркало `refs/pull/N/head` МОЖЕТ отставать от `refs/heads/<ветка>` — не «лениво вообще», а
выборочно: замерено 15.09 (curator, тред 209) на ДВУХ PR одного треда, запушенных одним тактом одной
руки, — `refs/pull/443/head` свеж, `refs/pull/444/head` на коммит позади.

```
e4da8a4d…  refs/heads/dev-core/209-guard1-names-a-failed-round
f323c70b…  refs/pull/444/head      ← ПОЗАДИ, а gh pr view --json headRefOid = e4da8a4d
a97d7f74…  refs/heads/dev-core/209-mute-census-counts-by-completion
a97d7f74…  refs/pull/443/head      ← свеж
```

**Why:** отказ МОЛЧАЛИВ — `git fetch origin pull/N/head` не ругается, имя рефа каноничное, SHA
полон, и вывод выглядит замеренным. Цена в поле: отставший `f323c70b` — голова ДО влива `main`, блоб
`claude-review.yml` у неё `4eb5716d8` против `b2babcfb9` на `main` и на настоящей голове. Та самая
сверка блоба, которой решают «покупает метка честный круг или красный самопропуск», по пулл-рефу
дала бы ОБРАТНЫЙ истине вывод («окно открыто, метку снять, влить `main` заново») на голове, где всё
сошлось. Это ОТДЕЛЬНАЯ болезнь от [[merge-ref-lags-behind-main]]: там протухает БАЗА у
`refs/pull/N/merge` и различается чтением `%P`; здесь протухает САМА голова, и `%P` сверять не с чем.

**How to apply.** Голову PR называет `gh pr view <N> --json headRefOid` либо `git ls-remote origin
refs/heads/<ветка>`; дифф и блоб берутся ОТ НЕЁ:

```bash
git fetch -f origin <ветка>:refs/tmp/<слаг> && git diff $(git merge-base origin/main refs/tmp/<слаг>) refs/tmp/<слаг>
```

Дёшево и разово: `git ls-remote origin 'refs/heads/<ветка>' 'refs/pull/N/*'` печатает обе стороны
одной строкой и ловит расхождение до того, как из него сделан вывод. Дверь `merge-gate` этим не
болеет — она спрашивает голову у API; болеет РУКА, читающая дифф привычным `pull/N/head`.

Связано: [[pinned-blob-rots-in-the-review-circle]], [[reproduce-with-the-tool-that-measured]],
[[pr-state-rots-while-you-measure-it]], [[review-round-mechanics]].
