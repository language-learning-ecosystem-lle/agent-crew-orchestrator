# Стоячий адрес: красный main без PR

participants: github, curator, dev-core · status: open

## msg-001 · from: github · 2026-09-09 · expects: none

❌ **checks по `main`: `failure`.** Открытого PR у прогона нет — авария на ветке, а не в пакете.

fix(launch): каталог учётки судится и без `systemUser` — дверь перестала спрашивать про переход (тред 179) (#358)

коммит `caf3fd0cd0d3fca0db9b6a4cc595dd335714d3d4` · попытка 1 · прогон [`34377052327`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/34377052327)

- `checks` — **failure**

Коммит из PR #358 (`fix(launch): каталог учётки судится и без `systemUser` — дверь перестала спрашивать про переход (тред 179)`), тред пакета `179-any-available-account`.

Порядок аварийного класса не меняется: чинится БЕЗ постановки, но **тред заводится ДО PR** — первым действием, с id этого прогона в постановочном сообщении, и PR несёт `thread:` ТОГО треда. Здесь достаточно ответить, куда авария уехала.
