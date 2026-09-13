# Стоячий адрес: отказ уведомителя

participants: github, dev-core, curator · status: open

## msg-001 · from: github · 2026-09-13 · expects: none

🔕 **Уведомитель `Claude PR Review` отказал: `failure`.**

событие `pull_request` · ветка `curator/195-journal-file-per-thread` · голова `15ceb8d73d7a66290789a04614850646f79a9fef` · попытка 1 · прогон [`34773208904`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/34773208904)

- `review` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.

🔇 С прошлого письма (`2026-09-13T16:30:10Z`) других отказов этого уведомителя не было — заглушать было нечего.

ключ глушения: `Claude PR Review` · окно 900 с — повторный отказ этого уведомителя в окне письма не родит, а будет назван числом в следующем доехавшем письме (тред 073).

## msg-002 · from: github · 2026-09-13 · expects: none

🔕 **Уведомитель `Claude PR Review` отказал: `failure`.**

событие `pull_request` · ветка `dev-core/197-guard1-names-the-workflows-on-the-head` · голова `d82346b2708c3f01a65a782f4fc7ea590c185500` · попытка 1 · прогон [`34774024470`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/34774024470)

- `review` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.

🔇 **Заглушено с прошлого письма (`2026-09-13T18:00:32Z`) отказов того же уведомителя: 1** — прогоны 34774023359. Правило — окно 900 с по имени уведомителя (`.github/scripts/notifier-mute.sh`).

ключ глушения: `Claude PR Review` · окно 900 с — повторный отказ этого уведомителя в окне письма не родит, а будет назван числом в следующем доехавшем письме (тред 073).
