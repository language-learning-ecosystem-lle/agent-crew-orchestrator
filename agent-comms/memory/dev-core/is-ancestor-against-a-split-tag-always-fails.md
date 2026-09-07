---
name: is-ancestor-against-a-split-tag-always-fails
description: "`git merge-base --is-ancestor <коммит main> <sha тега реза>` отдаёт 1 ВСЕГДА — subtree split переписывает историю; годность мерится другими тремя командами."
metadata: 
  node_type: memory
  type: project
  originSessionId: 37c245b7-ce51-4bdd-9a2c-b006370c8bf9
  modified: 2026-09-07T19:26:12.607Z
---

Тег `scripts/split-package.sh` стои́т на коммите `git subtree split`, а тот переписывает историю
под корень пакета: коммиты `main` его предками не являются НИКОГДА. Замер 2026-09-07,
`agent-protocol-v0.2.12` (`8bb6df26`): `git merge-base --is-ancestor 5126baae 8bb6df26` → **exit 1**,
хотя починка `5126baae` в срезе лежит целиком. То же и у прошлого тега (`v0.2.11` против своего
бампа `c9a9ca42`) → exit 1: это свойство реза, а не дефект конкретного тега.

**Why:** ненулевой код здесь читается как «починки в теге нет» и способен остановить доставку —
или, наоборот, заставить перерезать годный тег. Заказ на такую проверку приходит в постановке
почти дословно (msg-007/msg-013 треда 160), потому что формулируется до того, как кто-то посмотрел
на устройство реза.

**How to apply:** мерить три другие вещи, и все три дают exit 0 / равенство:
1. **срезаемая ревизия несёт починку** — `git merge-base --is-ancestor <fix> <ref реза>` (тут
   `5126baae` vs `73e9abcc`);
2. **дерево тега тождественно пакету в линии** — `git rev-parse <tag>^{tree}` = `git rev-parse
   <ref>:packages/agent-protocol` (тут обе `573a6aa3`);
3. **образ починки — предок тега** — субъект коммита ищется в `git log --oneline <tag>`, у образа
   своё имя (`5126baae` → `0a3abea5`), и `--is-ancestor <образ> <sha тега>` → 0; его дерево равно
   `<fix>:packages/agent-protocol`.

Отступление от буквы заказа объявляется в докладе вместе с exit-кодом, а не молча заменяется —
см. [[release-tag-number-does-not-say-what-it-carries]], [[commutative-merge-is-not-proof-nothing-was-eaten]].
