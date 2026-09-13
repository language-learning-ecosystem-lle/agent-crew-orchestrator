---
name: dry-run-is-a-free-oracle-on-the-ceilings
description: "Сухой `orchestrator run --role R --thread T` (без --write) печатает живое состояние потолков и не пишет в журнал ни строки"
metadata: 
  node_type: memory
  type: project
  originSessionId: d6074103-ac97-4e12-b7f3-0afae5437bdc
  modified: 2026-09-13T11:03:05.067Z
---

`orchestrator run --ref origin/main --role R --thread T` **без `--write`** спрашивает дверь
планировщика (клапан §3.4) и печатает её ответ, не записывая в мир НИЧЕГО: замерено
2026-09-13 — пять вызовов подряд, `.orchestrator/journal.jsonl` 6294 → 6294 строк.

Что он отдаёт даром:
- `role-busy` / `box-busy` — потолок, сколько мест занято, ключ конфига и **сами пары со
  временем подъёма** (`held by dev-core×177-… since 10:47:17Z, …`), exit 2;
- `parked` / `held` / `quota` / `auth` — причина по имени, exit 2;
- разрешённая пара — exit 0 и ПЛАН с предсобытием `{"kind":"launch",…,"by":"hand"}`.

**Why:** это единственный способ узнать «кто сейчас держит места роли и с какого часа», не
поднимая сессии и не читая журнал руками; `orchestrator status` отвечает на другой вопрос и
читает ЛОК рабочего места, а не фолд аренд — см. [[worktree-lock-and-lease-fold-are-two-instants]].

**How to apply:** нужно знать, поднимется ли пара, — спроси клапан сухим вызовом, а не выводи
из `status`. Свою же сессию клапан назовёт держателем: изнутри пары рукой поднимается максимум
`pairsPerRole − 1` — см. [[hand-raise-from-inside-a-pair-is-ceiling-minus-one]].
