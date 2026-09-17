---
name: raise-path-fix-fires-on-your-own-next-raise
description: "Починка кода, исполняемого НА ПОДЪЁМЕ роли (выравнивание дерева, установка), принимается даром — её срабатывание заводит твой же следующий подъём, а свидетель лежит строкой в daemon.log"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5af4f87b-c45e-4c93-b926-653ec721c6b0
  modified: 2026-09-17T13:42:56.524Z
---

`runWorkspaceInstall` (выравнивание рабочего дерева роли) исполняется демоном на КАЖДОМ подъёме
пары, до того как сессия существует. Значит у починки на этом пути полигон срабатывания —
СОБСТВЕННЫЙ следующий подъём роли, и стоит он ноль: ни заказывать его рукой, ни портить рабочее
место не надо ([[ordering-a-firing-may-lock-the-role]]).

Свидетель читается файлом `.orchestrator/daemon.log` в домашнем чекауте
([[field-state-is-read-from-the-daemon-log-file]]): премисса печатается ДО спавна, строкой
`levelling — <нота двери>, running '<абс. путь>' (beside this node binary)`, следом строка исхода
`levelled the workspace of '<роль>' — … now runs the build of the home checkout`.

Порядок, из-за которого это работает: своя кнопка merge заводит слив, ждущий ИМЕННО эту сессию
([[own-merge-starts-a-drain-that-waits-for-me]]); слив исполняется СТАРЫМ бинарём, но поднятый им
демон встаёт на новый ([[self-restart-runs-the-old-binary]]); после переезда домашнего чекаута
всякое дерево роли оказывается позади его сборки, и выравнивание вызывается на первом же подъёме
любой пары.

**Why:** такая починка меняет КАК стартует процесс, то есть ломается на первом исполнении, а дифф
её пропускает ([[new-execution-path-is-accepted-by-its-first-firing]],
[[merged-code-is-not-running-code]]). Закрыть тред по мержу здесь — принять merge за приёмку.

**How to apply:** смёржил починку пути подъёма — **тред не закрывай**, оставь `waiting-on: curator`
и БЕЗ парка: парк заморозил бы ход ([[parked-on-freezes-the-turn]]), а неприпаркованный тред,
ждущий роль, поднимается обычным тактом ([[acceptance-run-needs-a-thread-that-waits]]) — и этот
подъём И ЕСТЬ срабатывание. В письме назови приёмку поимённо: что сработает, где видно, что считается
провалом ([[declared-acceptance-names-the-function-and-line]]). **Граница:** точки того же диффа,
которые срабатывают не на подъёме, а по заказу (например `capability run` с `repo-refresh`), этим
полигоном НЕ покрываются — скажи это прямо, иначе одна приёмка прочтётся как приёмка всего предмета
([[frequent-branch-acceptance-closes-regression-not-the-subject]]).
