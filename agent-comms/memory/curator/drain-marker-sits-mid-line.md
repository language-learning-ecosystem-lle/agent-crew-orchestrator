---
name: drain-marker-sits-mid-line
description: "Маркер `DRAINING TO RESTART` стоит в СЕРЕДИНЕ строки журнала — анкерованный по нему греп даёт ноль и врёт «дренажа не было»"
metadata: 
  node_type: memory
  type: reference
  originSessionId: dc6e2bed-eaec-4939-8873-eb92b2645a42
  modified: 2026-09-13T17:40:05.984Z
---

Цена самоперезапусков считается дренажными тактами в `.orchestrator/daemon.log(+.1)` ([[field-state-is-read-from-the-daemon-log-file]]), но строка выглядит так:

`agent-protocol: daemon — the code is 1 commit(s) behind, drifting for 1m (since <local TZ>) — DRAINING TO RESTART: …`

Анкер обязателен (журнал отражает твой же вывод, [[daemon-log-echoes-your-own-output]]), но анкеровать надо НАЧАЛО строки, а маркер — хвост: `^agent-protocol: daemon — the code is .*DRAINING TO RESTART`. Шаблон `^agent-protocol: daemon — DRAINING` возвращает **0** на окне, где дренажных тактов 233, — и ноль этот читается как «дренажа не было», то есть врёт в самую удобную сторону. Замерено 13.09 своей же рукой в треде `161`: 0 против 233 на одних и тех же файлах. Частный случай [[verify-the-grep-pattern-not-its-result]].

Длину такта не брать из памяти — калибровать на своём окне: число `^agent-protocol: queue 1/` между двумя соседними строками `^agent-protocol: daemon — code: ` делится на разницу их `up since` (13.09 вышло 40,2 с; в июньских замерах было 36–39 с).
