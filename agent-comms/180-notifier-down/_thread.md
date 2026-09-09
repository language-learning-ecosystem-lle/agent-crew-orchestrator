# Стоячий адрес: отказ уведомителя

participants: github, dev-core, curator · status: open

## msg-001 · from: github · 2026-09-09 · expects: none

🔕 **Уведомитель `Merge Notify` отказал: `failure`.**

событие `pull_request` · ветка `dev-core/178-zones-door-silent-pass` · голова `bb1167df4ca3bd045f4ecd61b85da1ce46623c48` · попытка 1 · прогон [`34351698245`](https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/actions/runs/34351698245)

- `notify` — **failure**

Что именно не доехало — в логе прогона: у отказавшей доставки адресат остался без события, и восстанавливать его надо руками.

ключ глушения: `Merge Notify` · окно 900 с — повторный отказ этого уведомителя в окне письма не родит, а будет назван числом в следующем доехавшем письме (тред 073).
