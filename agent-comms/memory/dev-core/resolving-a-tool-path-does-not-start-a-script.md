---
name: resolving-a-tool-path-does-not-start-a-script
description: "Абсолютный путь до инструмента не гарантирует запуска: pnpm — скрипт с #!/usr/bin/env node, и интерпретатор ищется по имени в PATH ПОРОЖДЁННОГО процесса (exit 127)"
metadata:
  type: reference
---

Замер поля 17.09 (тред 219, второй отказ той же цепочки — уже ПОСЛЕ того, как резолюция пути
стала живой): `running '/home/…/bin/pnpm' (beside this node binary)` — путь верный — и следом
`ran and exited 127: /usr/bin/env: 'node': No such file or directory`.

- `pnpm`/`npm`/`npx`/`corepack` в раскладке nvm — **скрипты** с первой строкой
  `#!/usr/bin/env node`; `git`/`gh`/`du`/`id`/`ssh`/`ssh-keygen` и бинарь сессии `claude` —
  ELF (замерено `head -c 60`);
- резолюция пути решает, какой ФАЙЛ откроет ядро, и ничего не решает об интерпретаторе: его
  ищет `env` по `PATH` **порождённого** процесса;
- значит `127` от инструмента бывает ДВУХ родов, и чинятся они противоположно: «инструмент
  выбрал 127 сам» против «его интерпретатор не найден» — второй читается по тексту жалобы
  (`env: 'node': …` у GNU, `env: node: …` у busybox);
- лечится средой спавна: каталог `dirname(process.execPath)` первым в `PATH` ребёнка
  (`environmentForSpawnedTool` в `orchestrator/tool-path.ts`), а не `PATH` самого процесса.

Родня: [[beside-node-shim-needs-an-execpath-override]], [[nonzero-probe-exit-means-check-did-not-happen]].
