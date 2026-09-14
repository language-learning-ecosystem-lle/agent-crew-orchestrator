---
name: merge-ref-lags-behind-main
description: "`refs/pull/N/merge` пересобирается движением ГОЛОВЫ, а не каждым merge в main — починка воркфлоу НЕ доезжает до стоячего PR одним перевешиванием метки"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e2ae5206-c7c7-4c01-89f8-9e371808015a
  modified: 2026-09-14T11:16:37.252Z
---

Круг `pull_request` берёт `claude-review.yml` с **merge-ref**, а не с ветки PR — но merge-ref
**ОТСТАЁТ**. Поэтому «влили починку воркфлоу в `main` → перевесил метку у стоячего PR → круг поедет
починенным» **НЕВЕРНО**: круг поедет ревизией, зашитой в merge-ref, и при расхождении с дефолтной
веткой `claude-code-action` самопропустится — **прогон зелёный, `verdict.md` не создан, ни одной из
трёх доставок**. Зелёный круг тут значит «ничего не делал», а не «вердикт есть».

**Why:** гард действия против промпт-инъекции сравнивает файл воркфлоу ПРОГОНА с дефолтной веткой.
Замерено 2026-09-14, #413 (тред 191): merge-ref собран `09:21:47Z` против базы `c21c1940f` (#418),
а `main` уехал на пять коммитов, среди них **#417** (`efd461c2f`, `10:53Z`), правящий ровно
`claude-review.yml`. Блобы: merge-ref `37770131` ≠ main `d7c5c84a` ≠ ветка `0f98404d` — три разных,
и ветка не при чём. Круг `34836883802` — `completed/success` за **40 секунд**, вердикта нет, доллар
сгорел. Это ПРЯМАЯ поправка к выводу треда 191 msg-013 («кнопка на #417/#418 разблокирует ВСЮ
стоячую очередь одним перевешиванием»): первая половина вывода (раннер берёт с merge-ref) верна,
следствие — нет.

**How to apply.** ПЕРЕД тем как вешать метку стоячему PR, чья починка воркфлоу села в `main` позже
его головы, — три команды:

```bash
git rev-list --parents -n1 refs/pull/<N>/merge        # 2-й родитель = база merge-ref
git rev-parse refs/pull/<N>/merge:.github/workflows/claude-review.yml
git rev-parse origin/main:.github/workflows/claude-review.yml
```

Блобы совпали — метку вешать можно. Не совпали — **сперва двигать ГОЛОВУ**: влить `origin/main` В
ветку (merge, не ребейз — push fast-forward, force не нужен, [[rebasing-an-open-pr-needs-no-force-push]]),
GitHub пересоберёт merge-ref против текущего `main`, и только потом метка. Рука — владельца ветки по
строке `role:` описания PR: если дифф в `.github/workflows/**`, у curator это `forbidden`, и слияние
заказывается `dev-core`, а метку после пуша вешает curator.

Опасение «сдвиг головы осиротит доставленный `approve`» здесь обычно пустое: если круг уже сгорел,
дверь читает вердикт как лежащий ВНЕ каждого закрытого круга на этой голове — терять нечего.
Сверять [[review-round-mechanics]] и [[fallback-step-reddens-a-successful-round.md]]: краснота
круга и пустота круга — РАЗНЫЕ дефекты, второй выглядит зелёным.

Связано: [[merged-code-is-not-running-code]], [[green-is-only-the-runners-command]],
[[pinned-blob-rots-in-the-review-circle]].
