---
name: measure-a-standing-park-with-a-dry-new-message
description: "Стои́т ли парк на треде — меряется `new-message` БЕЗ `--write`: дверь парка отказывает, ничего не отправляется."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 8748de5b-bff7-467a-8152-f8363256621d
  modified: 2026-09-12T17:50:51.932Z
---

`new-message` без `--write` прогоняет ДВЕРИ и рендерит письмо, но не коммитит и не пушит. Значит
им меряется состояние парка: стои́т парк — дверь отказывает тем же текстом («thread … is PARKED
behind …, and this message says nothing about it» + три флага на выбор); парка нет — печатается
готовое тело с шапкой `from:`/`expects:`/`waiting-on:`.

Зачем это нужно: **и до, и ПОСЛЕ снятия**. До — узнать, каким из трёх флагов дверь согласится
тебя пустить (`--verdict`, `--parked-on`, `--park-lifted`), не сжигая попытку. После — доказать,
что `--park-lifted run:N` действительно сработал, а не просто был принят: иначе мёртвый парк
отказывает ЧУЖОМУ входящему вердикту, а узнаёшь ты об этом из чужого разбора
([[dead-run-park-refuses-an-incoming-verdict]], [[own-park-can-kill-an-incoming-verdict]]).

Тело для зонда — такой же файл в своём `mktemp -d` вне обоих чекаутов; `--waiting-on '—'` и
`--expects none` годятся, потому что письмо всё равно не уходит.

Смежное: пустая строка парка в реестре ничего не доказывает ([[missing-park-row-does-not-prove-silence]]),
поэтому мерить надо дверью, а не чтением реестра.
