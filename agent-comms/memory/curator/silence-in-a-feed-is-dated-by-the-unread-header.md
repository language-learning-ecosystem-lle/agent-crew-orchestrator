---
name: silence-in-a-feed-is-dated-by-the-unread-header
description: "Тишину чужой ленты датирует шапка `--for`, а не счёт писем: «the last message is X's own letter of <ISO>»"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4a149cc1-631e-4b83-998d-aa4dcb395dcc
  modified: 2026-09-09T21:53:21.963Z
---

`thread show --for <роль>` первой строкой печатает `unread for <роль>: none — the last message in
the thread is <кто>'s own letter of <ISO>`. Это ДАТИРОВАННОЕ утверждение о ВСЕЙ ленте: с того момента
в неё не легло ничего, ни от кого.

**Why:** полевая приёмка вида «после мержа в ленте N не появилось нового письма» обычно меряется
счётом писем `from: github` — а счёт доказывает только равенство двух своих замеров и молчит о
письмах других авторов. Шапка `--for` сильнее и стоит одну команду.

**How to apply:** для приёмки «в чужой ленте тихо» бери шапку `--for` (ленту при этом только
ЧИТАЙ), а счёт писем оставляй вторым, независимым подтверждением. Тишину всегда пара́й со вторым
чтением — журналом ящика: молчащий сторож и сломанный по почте неразличимы ([[watcher-silence-needs-a-delivered-digest]],
[[field-state-is-read-from-the-daemon-log-file]]). Ординал `msg-NNN` при `--tail` едет —
ссылаться по автору и факту ([[cite-letters-by-author-and-fact]], [[head-on-thread-show-cuts-the-newest]]).
