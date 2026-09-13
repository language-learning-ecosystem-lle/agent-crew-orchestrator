---
name: park-run-under-a-review-round-lifts-on-the-verdict
description: "Под живым кругом РЕВЬЮ парк `run:<pr>` правилен — его снимает само письмо вердикта; выбор идёт по ТИПУ прогона, а не по «прогон живой»"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1e68d92f-3abe-454e-b127-e512a95e8202
  modified: 2026-09-13T14:48:52.440Z
---

Живой круг ревью → ход передаётся **с** `--parked-on run:<pr>`. Живой `checks` → **без** парка
([[no-park-beats-run-park-under-live-checks]]). Правило делит два живых прогона, а не объединяет их.

**Why:** второй лифт парка `run:N` — объявленная пара `verdict:` / `pr: N` в шапке письма
(`standingParkOf`, `thread.ts`: `named.kind === "run" && verdicts.has(named.pr)`, тело не читается),
и ровно её несёт письмо ревьюера: `claude-review.yml` кладёт `VERDICT_ARGS="--verdict ${VERDICT}
--pr ${PR}"` — «либо оба флага, либо ни одного». То есть ждёшь письма, которое И ЕСТЬ адрес парка:
снимается в тот же такт, а такты до него не поднимают никого. У `checks` такого поля в шапке нет
вовсе, поэтому там тот же парк достоит до потолка
([[run-park-under-checks-ends-only-by-ceiling]]).

**Цена ошибки замерена 13.09:** передача хода БЕЗ парка под живым кругом ревью подняла пару в
`14:27:15.914Z` — через 54 с после своего же письма, при `unread for curator: none`. Полезным подъём
стал лишь потому, что вердикт приехал ещё через 71 с; при лимит-смерти круга (45…56 с) письма о
вердикте не бывает вовсе, и подъём сжёг бы попытку. Это не теория: в `daemon.log` того же часа
`curator×187` — «4 of 3 failed», `curator×155` — «6 of 3», `dev-core×189` — «5 of 3», у всех трёх
`⛔ OUT OF ATTEMPTS`. Платит и чужая очередь: потолок коробки 3 пары
(`parallelism.pairsPerInstance`), и пустой держатель места вытесняет кандидатов строкой «the ceiling
of this BOX is full».

**Приём парка дверь подтверждает СТРОКОЙ, и её стоит прочесть** (замер 13.09, #398): при `--write`
перед отправкой печатается «the park on PR #N waits for a run that is still running (1 of 2 on head
<sha7>)» — это единственный парк, чей источник дверь спрашивает у `gh`, и на голове БЕЗ живых
прогонов письмо отказывается целиком. Пустая строка здесь = парк не на чем стоять.

**How to apply:** повесила метку `review` — паркуйся на `run:<номер PR>` и передавай ход. Не
путать с [[no-park-beats-run-park-under-live-checks]]: там прогон другой и лифта у парка нет. Оба
исхода круга приезжают письмом ([[outcome-branch-letter-raises-on-any-branch]]), а мёртвый круг
узнаётся длительностью ([[burned-round-is-read-in-the-result-record]]).
Связано: [[park-forms-both-take-the-pr-number]], [[park-goes-after-the-verdict-not-before]].
