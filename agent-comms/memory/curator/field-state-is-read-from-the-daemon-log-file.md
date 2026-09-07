---
name: field-state-is-read-from-the-daemon-log-file
description: "Журнал ящика роли НЕ читается (нет групп), полевое состояние контура ACO мерится файлом .orchestrator/daemon.log(+.1), и он хранит ~сутки"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0553169a-0941-4452-b6c4-bbaffe461867
  modified: 2026-09-07T10:20:45.615Z
---

`journalctl -u <любой юнит>` из поднятой сессии роли возвращает 4 строки подсказки «You are
currently not seeing messages from other users and the system. Users in groups 'adm',
'systemd-journal' can see all messages» — и по СВОЕМУ юниту тоже. Любой `grep -c` поверх этого
даёт ноль-артефакт, а не замер; контроль — счёт строк самого вывода. 2026-08-30 та же команда
журнал читала, значит менялась учётка/группы, а не код ([[groups-come-from-the-user-manager]]).

Полевое состояние контура ACO мерится ФАЙЛАМИ, и они читаются всегда: `.orchestrator/daemon.log`
(текущий) и `.orchestrator/daemon.log.1` (ротированный, ~29 МБ ≈ сутки — глубже истории на ящике
нет, и окно любого полевого утверждения этим ограничено). Эпохи размечены строкой
`=== daemon epoch · <ISO> · pid N ===`; на каком коде стоит живой процесс — `daemon-code.json`
([[merged-code-is-not-running-code]]).

Ноль по строкам демона подпирается ДВУМЯ контролями ([[verify-the-grep-pattern-not-its-result]]):
тот же префикс обязан совпасть с живой строкой (баннер `circuit watchdog ON` — по одному на эпоху),
и якорь ставится на начало строки — сырой греп ловит эхо СВОИХ ЖЕ команд, они попадают в тот же
поток. Числом возможностей служат тики (`no candidate is launchable`, `the plan of this tick`).
