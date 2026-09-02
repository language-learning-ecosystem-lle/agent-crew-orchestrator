# Стоячий адрес: отказ уведомителя

participants: github, dev-core, curator · status: open

## msg-001 · from: curator · 2026-09-02 · expects: none

**Стоячий адрес. Заведён прогоном curator по треду `073-notifiers-frozen-in-own-contour` (решение john 2026-09-02 «размораживай оба»).**

## Что сюда приезжает

**Отказ уведомителя** — прогон одного из воркфлоу, которые доставляют события контура в почту, завершившийся `failure`/`timed_out`/`startup_failure`/`action_required`/`stale`. Пишет `.github/workflows/notifier-watch.yml`, переменной `THREAD`; письмо идёт `--from github --expects none --waiting-on dev-core` — воркфлоу контура его зона.

Список наблюдаемых на 2026-09-02: `CI Outcome`, `Merge Notify`, `Comms Derived`, `Claude PR Review`. Он живёт в `notifier-watch.yml` и меняется вместе с ним, а не здесь.

## Зачем адрес нужен отдельно

Молчащий уведомитель — молчащий арбитр: с `2026-08-30T20:14Z` по `2026-09-02` из GitHub в почту не доехало ни одного письма, шесть merge john ушли в тишину, и нашёл это john глазами по красным прогонам в Actions. Смотритель существует, чтобы этот класс звонил, а не лежал красной строкой, которую никто не открывает.

## Чем этот тред отличается от рабочего

- **это адрес, а не тема.** Тред стоит открытым и не ждёт никого по умолчанию: ход появляется в нём событием;
- **разбор отказа здесь не ведётся.** Письмо называет прогон, джобы и голову; починка ставится своим тредом, а сюда возвращается строкой со ссылкой;
- **тред не закрывается и не паркуется.** У `notifier-watch.yml` один путь и один адрес: дверь, отказавшая по имени треда, печатает `::error::` и роняет шаг — то есть каждый отказ уведомителя стал бы ВТОРЫМ красным прогоном, из которого в почту не доедет ничего.
- **последнее звено названо, а не закрыто:** `workflow_run` не рекурсивен, отказ самого смотрителя ему же не приедет. Лестницу смотрителей не строим; смотритель нарочно тонкий.

Предыстория класса — контур-родитель, тред `042-notifier-down`; здесь у него свой номер, потому что номера в этой почте свои.

## msg-002 · from: github · 2026-09-02 · expects: none

🔕 **Уведомитель `Comms Derived` отказал: `failure`.**

событие `push` · ветка `comms` · голова `5195c1a496f5537874855cedc2e5b136c9bbc1e4` · попытка 1 · прогон [`33656370292`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/33656370292)

- `derive` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.

## msg-003 · from: github · 2026-09-02 · expects: none

🔕 **Уведомитель `Comms Derived` отказал: `failure`.**

событие `push` · ветка `comms` · голова `b1faffdeb64ec8e8ad0d6c366edf3ff1cc92445b` · попытка 1 · прогон [`33656570864`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/33656570864)

- `derive` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.

## msg-004 · from: github · 2026-09-02 · expects: none

🔕 **Уведомитель `Comms Derived` отказал: `failure`.**

событие `push` · ветка `comms` · голова `6f84d2b04f82195fc649779f0df6a2f0f3dbf5e8` · попытка 1 · прогон [`33656622001`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/33656622001)

- `derive` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.

## msg-005 · from: github · 2026-09-02 · expects: none

🔕 **Уведомитель `Comms Derived` отказал: `failure`.**

событие `push` · ветка `comms` · голова `f82c8e06f2faf9bd073780ac18848a683f96cbda` · попытка 1 · прогон [`33656650615`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/33656650615)

- `derive` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.

## msg-006 · from: github · 2026-09-02 · expects: none

🔕 **Уведомитель `Comms Derived` отказал: `failure`.**

событие `push` · ветка `comms` · голова `57b9cb633e466d4b7f81dbf5d24286d5c5413751` · попытка 1 · прогон [`33656691660`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/33656691660)

- `derive` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.

## msg-007 · from: github · 2026-09-02 · expects: none

🔕 **Уведомитель `Comms Derived` отказал: `failure`.**

событие `push` · ветка `comms` · голова `26bd08dc12a7b56f85dd05a6613e7333f2b46929` · попытка 1 · прогон [`33657276761`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/33657276761)

- `derive` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.

## msg-008 · from: github · 2026-09-02 · expects: none

🔕 **Уведомитель `Comms Derived` отказал: `failure`.**

событие `push` · ветка `comms` · голова `7814a457100c66b6251d454feada19388c3e47dc` · попытка 1 · прогон [`33657341450`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/33657341450)

- `derive` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.

## msg-009 · from: github · 2026-09-02 · expects: none

🔕 **Уведомитель `Comms Derived` отказал: `failure`.**

событие `push` · ветка `comms` · голова `8b298c2e15cd95e532c06f58cdcf9bfbe340ba6d` · попытка 1 · прогон [`33657486974`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/33657486974)

- `derive` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.

## msg-010 · from: github · 2026-09-02 · expects: none

🔕 **Уведомитель `Comms Derived` отказал: `failure`.**

событие `push` · ветка `comms` · голова `cede67780abeaa0636daa84e9c333eecd320b070` · попытка 1 · прогон [`33657542629`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/33657542629)

- `derive` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.

## msg-011 · from: github · 2026-09-02 · expects: none

🔕 **Уведомитель `Claude PR Review` отказал: `failure`.**

событие `pull_request` · ветка `docs/067-park-lift-raised-at` · голова `181157ade2fbf939e48dca9acea696976b955e70` · попытка 1 · прогон [`33661622377`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/33661622377)

- `review` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.
