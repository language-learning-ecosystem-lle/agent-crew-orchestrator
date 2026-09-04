---
name: thread-ids-are-flat
description: "Подтредов `NNN.M` не существует — дверь записи принимает такой id, а обходчик тредов его не видит"
metadata: 
  node_type: memory
  type: project
  originSessionId: dba3e827-bdc5-4116-98bc-8d15ab97a478
  modified: 2026-09-04T02:00:26.553Z
---

Номера тредов ПЛОСКИЕ: `fs/comms.ts:34` — `const THREAD_DIR = /^\d{3}-/`. Каталог `047.1-…` не матчится и невидим для `thread show`, `mail` и демона. При этом `new-thread --write` такой id ПРИНИМАЕТ, коммитит и пушит с ответом «opened … committed and pushed» — измерено 2026-09-02, каталог `agent-comms/047.1-devops-enablement-acceptance`, коммит `3a17566c`, остался мусором в ветке (файлы почты рукой не убираются).

**Why:** класс «принято на записи, невидимо на чтении» тихий — `--write` докладывает успех, а исполнителя по треду не поднимет никто; постановка уезжает в никуда.

**How to apply:** новый дом — только следующий свободный трёхзначный номер (сверять по `ls` корня почты). После `new-thread --write` — контрольное чтение `mail --role <адресат>`, а не доверие ответу двери ([[reproduce-with-the-tool-that-measured]]). Связь с родителем несётся ПРОЗОЙ первой строки («происхождение: тред NNN»), а не номером ([[threads-owed-after-160]]).

**Номер выдаёт дверь, а не набирающий.** `new-message --ensure-thread` принимает ТОЛЬКО хвост-слаг: полный id она отказывает по имени («a whole thread id, not a slug … would be opened as `<next free NNN>-123-…`, i.e. a number in front of a number»), потому что сама печатает «no thread of this address exists yet — opening `NNN-<slug>` as its receiver». Измерено 2026-09-04 при заведении `123-repair-refusal-not-in-the-digest`: отказ немой цены, но `ls` корня почты всё равно нужен — чтобы знать, СУЩЕСТВУЕТ ли уже дом под этот предмет, а не чтобы вычислить номер. `thread status` при этом требует `--from <role>` (без него печатает usage, а не закрывает).
