---
name: byte-cut-text-goes-binary-and-grep-goes-silent
description: "`cut -c` режет БАЙТЫ — файл становится «бинарным», и греп по кириллице молча даёт ноль"
metadata: 
  node_type: memory
  type: reference
  originSessionId: e713a7c6-8400-4f9b-8524-16cb76e30551
  modified: 2026-09-09T23:19:47.116Z
---

Таблица, собранная через `cut -c1-130` из русского текста, содержит порванные UTF-8 символы. Дальше
`grep -c 'разморо' файл` печатает **НИЧЕГО** (rc=1), а `awk` ругается `Invalid multibyte data` — то
есть замер выглядит как «ни одного случая в поле», хотя случаев десятки. Стоило двух ходов 09.09.

Лечится двумя вещами вместе: `export LC_ALL=C.UTF-8` и `grep -a` (либо не резать байтами вовсе —
обрезать уже при печати, а не при сборке таблицы).

**Why:** нулевой вывод грепа читается как факт о мире, а был фактом о своей руке.
**How to apply:** ноль по кириллическому шаблону — сперва проверь тем же грепом заведомо
присутствующее слово. Связано: [[own-hand-crutches-hide-the-defect]],
[[reproduce-with-the-tool-that-measured]], [[verify-the-grep-pattern-not-its-result]].
