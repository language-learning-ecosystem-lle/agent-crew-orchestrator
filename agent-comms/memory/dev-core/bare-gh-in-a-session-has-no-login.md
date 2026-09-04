---
name: bare-gh-in-a-session-has-no-login
description: "Залогинен ли `gh` в сессии роли — МЕРИТСЯ, а не предполагается: с 2026-09-04 токен приезжает средой, и старый рецепт с `. secrets.aco.env` падает."
metadata: 
  node_type: memory
  type: project
  originSessionId: b2339f15-b1b2-4afa-966c-82e18489e27a
  modified: 2026-09-04T18:17:59.313Z
---

**Сначала замер, потом рецепт:** `gh auth status`. Ответ бывает разный, и оба вида живые.

- **Замер 2026-09-04 (тред `129`):** `GH_TOKEN` и `GITHUB_TOKEN` УЖЕ экспортированы в среду поднятой
  сессии, `gh auth status` отвечает `Logged in to github.com account maysway (GH_TOKEN)`, и голый
  `gh pr view/edit` работает без всякой подготовки. Команда пакета это видит и не перебивает —
  `pr mergeable` печатает `token GH_TOKEN ← the environment of the caller (not overwritten)`.
- **Как было до этого (тред `065`):** `GH_TOKEN` в среде не было вовсе, `~/.config/gh/hosts.yml` пуст,
  и креды брала САМА команда пакета из машинного конфига
  (`~/.config/agent-protocol/instances/<инстанс>.json` → `secrets.envFile`), а голый `gh` мимо неё падал.

**Старый рецепт «`set -a; . /home/lle/.config/agent-protocol/secrets.aco.env; set +a`» больше не
работает и молчит об этом:** этого пути под пользователем сессии нет (`Permission denied`; файл инстанса
`hetzner` — `/home/aco-hetzner/.config/agent-protocol/secrets.env`, тоже чужой). Хуже формы: `. файл
2>/dev/null && …` при неудаче рвёт `&&`-цепочку, и своя настоящая команда не выполняется вовсе —
выглядит как отказ `gh`, а на деле не запускалось (тот же класс, что [[gh-jq-failure-masquerades-as-api-refusal]]).

**Why:** предположение в обе стороны стоит команды: «залогинен» без замера даёт «нет прав», «не
залогинен» — источание несуществующего файла поверх исправной среды.

**How to apply:** `gh auth status` → залогинен, значит зови `gh` голым. Не залогинен — креды берёт
команда пакета, а не рука; путь `secrets.envFile` мерить по конфигу инстанса, а не по памяти. Граница
инстансов при этом та же — [[aco-session-cannot-reach-lle-repo]]. Для `git push` по https по-прежнему
помощник, а не токен в URL: `git -c credential.helper='!f(){ echo username=x-access-token; echo
"password=$GH_TOKEN"; };f' push …` — иначе токен уедет в текст ошибки. **Второй
`-c credential.https://github.com.helper=` рядом не ставить:** пустое значение обнуляет ВЕСЬ список
помощников, и push снова просит логин. И переменная бывает `GITHUB_TOKEN`, а помощник читает
`$GH_TOKEN` — экспортировать одно в другое.
