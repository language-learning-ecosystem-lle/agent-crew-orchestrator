---
name: beside-node-shim-needs-an-execpath-override
description: "Шим инструмента, который код ищет РЯДОМ С NODE, ловится подменой process.execPath через NODE_OPTIONS --import, а не каталогом в PATH"
metadata: 
  node_type: memory
  type: reference
  originSessionId: e0dc6045-e2a2-43b8-8e8f-802b84f487d2
  modified: 2026-09-17T13:23:28.660Z
---

Код, резолвящий инструмент через `dirname(process.execPath)` (`orchestrator/tool-path.ts`),
шим в `PATH` НЕ увидит — он уйдёт к настоящему бинарю рядом с node. Перехват ставится там,
куда смотрит резолюция:

- каталог стенда: шим (`pnpm`) + **симлинк `node` на `process.execPath`** + модуль
  `execpath.mjs` со строкой `process.execPath = "<каталог>/node"`;
- спавн: `env.NODE_OPTIONS = "--import file://<каталог>/execpath.mjs"` — переменная едет и во
  внуков, то есть в фонового ребёнка, который спавнится как `process.execPath`;
- `PATH` можно тогда дать без инструмента вовсе — это и есть доказательство перехвата.

Три замера, объясняющие, почему именно так: `process.execPath` — **записываемое** свойство
(`writable: true`); симлинк на node подменой НЕ работает — `execPath` резолвится до реального
бинаря через `/proc/self/exe` (поэтому симлинк нужен для СПАВНА, а подмена — для чтения);
хардлинк node рядом с шимом на этом ящике запрещён (`ln: Operation not permitted` —
`fs.protected_hardlinks`, бинарь чужого пользователя), а копия — 118 МБ на файл.

Образец в коде: `workspace-levelling.process.test.ts` (тред 221). Родня: [[git-shim-in-a-process-test-hits-every-git]],
[[gh-stub-dispatch-on-argv-position-misroutes]], [[daemon-process-test-must-name-the-binary-with-exec]].

**И проба внутри такого стенда читает `/proc/self/environ`, а не `process.env`** (замер 17.09,
тред 219): `NODE_OPTIONS` доезжает и до самого шима, если тот — node-скрипт, поэтому преload
переписывает `process.env.PATH` ПЕРЕД первой строкой пробы, и `process.env.PATH` в ней — это
последнее слово стенда, а не среда, с которой её спавнили. `/proc/self/environ` несёт исходный
envp процесса и подменой не задевается. Тем же приёмом (`process.env.PATH = "<каталог только с
git>"` в преloadе) стенд заявляет «у процесса нет node в PATH» изнутри процесса — снаружи так
не получится, потому что шелл, стартующий `tsx`, сам ищет node по `PATH`.
