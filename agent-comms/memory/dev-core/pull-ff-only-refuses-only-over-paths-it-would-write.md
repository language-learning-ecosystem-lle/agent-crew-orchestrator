---
name: pull-ff-only-refuses-only-over-paths-it-would-write
description: "`pull --ff-only` отказывает не над «любым untracked», а только над путями, которые входящие коммиты запишут; `--porcelain` по умолчанию эту коллизию прячет"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0a381aff-f869-484c-a191-270d39404b2c
  modified: 2026-09-07T11:41:01.372Z
---

Замерено 2026-09-07 на локальном стенде (`TMPDIR=/tmp`, origin + клон), семь случаев:

- посторонний untracked-файл, которого входящие коммиты не трогают → **exit 0**, дерево перематывается;
- untracked-сосед в каталоге, куда входящий коммит кладёт ДРУГОЙ файл → **exit 0**;
- untracked по пути, который входящий коммит добавляет → exit 1 (`untracked working tree files would be overwritten`);
- untracked ФАЙЛ `dir`, когда входящий добавляет `dir/inner.txt` → exit 1;
- содержимое git НЕ сравнивает: побайтово равный файл всё равно даёт exit 1.

Отсюда два практических следствия для любого кода, решающего «можно ли перематывать»:

- «есть untracked → грязь» — условие ШИРЕ git. Точная проверка: путь `p` опасен, если в
  `git diff --name-only -z --diff-filter=ACMRT HEAD <target>` есть `q`, где `q === p` или `q`
  начинается с `p + "/"`;
- **`git status --porcelain` по умолчанию (`-unormal`) скрывает коллизию**: целиком неотслеживаемый
  каталог печатается одной строкой `?? foo/`, и `foo/bar.txt`, над которым git откажет, в выводе не
  виден. Нужен `-uall`. И `-z`: путь с пробелом приезжает в кавычках (`?? "with space.txt"`).

Связано: [[silence-claim-is-checked-in-notify-state]] — та же порода «строка вывода не доказывает
того, что от неё ждут».
