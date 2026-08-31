---
name: contour-ground-check-needs-tmp
description: Проверка «почвы» двери контура из mktemp -d даёт ложно-зелёный — сессионный TMPDIR лежит внутри чекаута контура.
metadata: 
  node_type: memory
  type: project
  originSessionId: f2f3262d-eb9b-4dae-81ca-9f923af3c208
  modified: 2026-08-31T02:45:09.366Z
---

Живая проверка `judgeGround` (дверь контура, `packages/agent-protocol/src/roles/contour.ts`)
из `mktemp -d` показывает «почва своя» — **ложно-зелёный**. Причина не в двери: сессионный
`TMPDIR` (тред 056) лежит внутри `/home/lle/projects/agent-crew-orchestrator`, то есть внутри
чекаута контура `hetzner`, и `contourOf` честно называет его своим.

**Why:** стенд меряет не то, что кажется, и проверка границы «проходит» там, где должна отказать.

**How to apply:** ставить стенд `TMPDIR=/tmp mktemp -d`. И `node --import tsx` оттуда не
запустится (`tsx` не резолвится вне репозитория) — грузить лоадер абсолютным путём:
`node --import <repo>/node_modules/tsx/dist/loader.mjs <repo>/packages/agent-protocol/src/cli.ts …`.
Форма #453/#454 воспроизводится так: `git init` + `origin` чужого репозитория + коммит.
Рядом: [[local-suite-needs-short-tmpdir]].
