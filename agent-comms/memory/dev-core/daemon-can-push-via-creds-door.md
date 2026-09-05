---
name: daemon-can-push-via-creds-door
description: "У демона креды на push в `comms` ЕСТЬ — не в среде процесса, а через `platformEnvOf`/`secrets.env`; мерить `push --dry-run`."
metadata: 
  node_type: memory
  type: project
  originSessionId: c6639d12-b387-467f-ba66-6a8fe3e69c8f
  modified: 2026-09-05T13:21:07.101Z
---

Замер 2026-09-05 (тред `099`, предмет C): среда живого `orchestrator up` (пользователь
`aco-hetzner`) токенов НЕ держит — `/proc/<pid>/environ` без `GH_TOKEN`/`GITHUB_TOKEN`. Но
`platformEnvOf({repo})` читает `secrets.env` машинного конфига и отдаёт `GH_TOKEN` «← the secrets
file», `refusal: none`, и push в `comms` с этой средой проходит. То есть «в среде демона токенов
нет» НЕ значит «демон не может писать в почту».

**Why:** вывод «писателя почты у демона быть не может» напрашивается из пустой среды процесса и
он неверен; дверь кредов вычисляет среду дочернего вызова из конфига, а не наследует её.

**How to apply:** мерить не средой, а дверью: `platformEnvOf` + реальный `git push --dry-run
origin HEAD:<branch>` из ВРЕМЕННОГО клона (почту руками не трогать — R3). Свои токены снимать
(`env -u GH_TOKEN -u GITHUB_TOKEN`), иначе зелёное доказывает токен сессии — см.
[[green-on-the-box-may-lean-on-the-box-token]]. `--dry-run` не дешёвое чтение: он бьёт в
`git-receive-pack`, чья реклама рефов на GitHub требует права ЗАПИСИ и отдаёт 403 read-only
токену — но обновления рефа не делает, поэтому «ветка примет коммит» остаётся выведенным, а не
измеренным до конца, и в отчёте это различие называть.
