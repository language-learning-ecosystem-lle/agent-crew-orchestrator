---
name: released-turn-is-invisible-in-thread-show
description: "Отпущенный ход (`waiting-on: —`) в выводе `thread show` не печатается вовсе — мерить прочерк надо по ФАЙЛУ письма"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2b1ea17e-4cda-4c49-bd91-8a481d92d37c
  modified: 2026-09-17T16:47:34.353Z
---

`new-message --waiting-on —` пишет в файл сообщения строку `waiting-on: —`, а рендер
`thread show` эту строку НЕ печатает: у сообщения видно `from:` и `expects:`, и всё.
Замерено 2026-09-17 процессным тестом: `expect(shown).toContain("waiting-on: —")` красный,
хотя письмо ушло с прочерком, — в выводе после `expects: none` сразу идёт тело.

**Почему важно:** «в ленте нет строки про ход» доказывает не прочерк, а лишь то, что ход
кому-то принадлежит ИЛИ отпущен — две разные вещи, неразличимые в этом выводе.

**Как применять:** прочерк проверяется чтением файла
`<thread>/messages/<stamp>-<role>.md` (там строка есть дословно) либо `mail --role <кто>`
— тем же фолдом, из которого планировщик берёт кандидата. Ср. [[missing-park-row-does-not-prove-silence]].
