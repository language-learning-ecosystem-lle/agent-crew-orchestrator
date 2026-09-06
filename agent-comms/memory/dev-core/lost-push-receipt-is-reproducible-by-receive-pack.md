---
name: lost-push-receipt-is-reproducible-by-receive-pack
description: "Потерянная квитанция push'а воспроизводится без сети — обёрткой receive-pack; ключ конфига берётся по URL, а не по имени remote."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 732b1349-937e-46cc-9bf9-b29ebe24ddbf
  modified: 2026-09-06T19:43:49.065Z
---

«Сервер взял, клиент отчитался провалом» **воспроизводится на диске**, и догадка «наверное, не
получится» тут неверна. Обёртка зовёт настоящий `git receive-pack "$@"` и выходит `exit 1`: ref на
удалённой стороне уезжает, `git push` возвращает 1.

**Ключ конфига — по URL, а не по имени remote,** и это единственная нетривиальная часть:

* `remote.<путь>.receivepack` git ОТВЕРГАЕТ — `config remote shorthand cannot begin with '/'`;
* `remote.<https-url>.receivepack` работает, даже когда секции `[remote]` с таким `url` нет, а сам
  url переписан в путь через `url.<путь>.insteadOf` — это и есть форма, в которой пушит дверь
  (`git push "$URL" HEAD:comms`, названного remote у неё нет вовсе);
* `ext::`-транспорт этой задачи не решает: он запрещён по умолчанию (`transport 'ext' not allowed`),
  а после `protocol.ext.allow=always` ломается на разборе кавычек своей же команды.

Замерено 2026-09-06, тред `137-double-letter-on-lost-push-receipt`: состояние (16)
`review-delivery.integration.sh`. Мутация (проба в двери отключена) даёт **7 писем вместо 2** — шесть
писем одного прогона поверх письма фикстуры.

Мутантный прогон гнать **в рабочем дереве**: копия чекаута в `/tmp` покраснела всеми состояниями и не
доказывала ничего — см. [[green-depends-on-where-the-checkout-lives]] и [[new-test-must-be-proven-by-mutation]].
