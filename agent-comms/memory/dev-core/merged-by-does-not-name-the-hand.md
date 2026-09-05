---
name: merged-by-does-not-name-the-hand
description: "`mergedBy` у PR не различает кнопку john и merge роли — токен контура PAT одного аккаунта; руку доказывает след гардов, а не поле."
metadata: 
  node_type: memory
  type: project
  originSessionId: aff04a9c-93fc-4e59-a915-0d7b3501fbbf
  modified: 2026-09-05T16:50:47.837Z
---

`mergedBy: maysway` у слитого PR **не называет, чья рука нажала**: токен контура — PAT того же
аккаунта, поэтому и merge роли (curator по пяти гардам), и кнопка john печатают в этом поле одно имя.

**Why:** я подал «merge сделан не curator, значит след гарда 5 не написан» как факт без претензии —
это был вывод из одного поля, и он оказался неверен: след стоял в письме, разошедшемся с моим.

**How to apply:** руку доказывает СЛЕД, а не поле — письмо мержившего с гардами поимённо (и `STOP`
гарда 4 плюс письмо john ДО мёржа, если рука его). Не увидел следа — сначала перечитай ленту с
`--for <своя роль>`: [[letters-cross-measure-the-other-stamp]]. Родственное:
[[merge-gate-guard2-reports-the-review-round]].
