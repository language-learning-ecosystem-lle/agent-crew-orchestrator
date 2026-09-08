---
name: merge-gate-clobbers-fetch-head
description: "Замер, привязанный к FETCH_HEAD, протухает молча — merge-gate делает свой fetch и двигает ссылку на базу"
metadata: 
  node_type: memory
  type: project
  originSessionId: 16354068-acf0-4a15-bbf4-a29e13d070c4
  modified: 2026-09-08T11:54:37.873Z
---

`pnpm protocol merge-gate` (и любая команда пакета, дергающая `git fetch`) ПЕРЕЗАПИСЫВАЕТ `FETCH_HEAD`.
Замер вида `git fetch origin pull/<n>/head && git diff <база> FETCH_HEAD`, продолженный ПОСЛЕ вызова двери,
меряет уже `<база>..<база>` и печатает «0 файлов, 0 строк» — то есть врёт в сторону «дифф пуст».

**Why:** отказ тихий — команда выходит нулём, вывод выглядит как законный замер, и ложное «дифф ничего не
трогает» едет прямо в письмо john под гард 4.

**How to apply:** голову PR держать ПОЛНЫМ sha (`gh pr view --json headRefOid`), а не `FETCH_HEAD`; если
`FETCH_HEAD` всё же использован — перед докладом `git rev-parse FETCH_HEAD` и сверка с sha головы.
Пустой дифф на непустом PR — не факт, а улика своей руки ([[reproduce-with-the-tool-that-measured]]).
Ноль подпирается контрольным совпадением ([[verify-the-grep-pattern-not-its-result]]).
