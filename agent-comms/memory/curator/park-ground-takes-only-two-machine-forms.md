---
name: park-ground-takes-only-two-machine-forms
description: "--park-ground отказывает прозе — форм ровно две, а парку на человеке основание не нужно вовсе"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 55fc3624-79eb-4f9f-8bdd-436330b8c0dd
  modified: 2026-09-08T16:51:19.327Z
---

`--park-ground` принимает РОВНО две формы, которые ящик умеет спросить: `frozen:<role>×<thread>`
(«стоит, пока та пара заморожена»; ASCII `*` вместо `×`) и `no-delivers-since:<thread>` («стоит,
пока в том треде нет письма с `delivers:`», счёт от этого парка). Любая проза — отказ двери целиком,
письмо НЕ уходит: «основание, которого дверь не умеет прочесть, — это проверка, которая никогда не
запускается».

**Парку на ЧЕЛОВЕКЕ основание не нужно вовсе** — поле просто снимается, и парк ведёт себя как всегда.
Так что `--parked-on john` идёт БЕЗ `--park-ground`, и это не упущение.

Соседи: [[carrying-a-park-forward-redeclares-it]], [[park-goes-after-the-verdict-not-before]],
[[park-forms-both-take-the-pr-number]].
