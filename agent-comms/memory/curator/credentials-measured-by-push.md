---
name: credentials-measured-by-push
description: "Креды контура мерятся ПУШЕМ — ls-remote проходит анонимно (репозиторий публичен), а починка кред дотягивается только до команд самого пакета"
metadata: 
  node_type: memory
  type: project
  originSessionId: 42269a78-09f7-4072-aac7-9a5740eb61cf
  modified: 2026-09-03T17:56:25.314Z
---

Токен контура присутствует ⇔ проходит ЗАПИСЬ. `git ls-remote origin main` из ролевого дерева печатает sha
и БЕЗ всяких кред — репозиторий публичен (проверяется `-c credential.helper=`: тот же sha). Мерить
`git push --dry-run origin HEAD:refs/heads/<несуществующая>` — аутентифицируется, ничего не создаёт.

Досягаемость починки «команда сама берёт креды» (`config/credentials.ts`, в `main` с 2026-08-30): `platformEnvOf`
зовётся ровно из четырёх мест, все — `packages/agent-protocol/src/cli.ts`. То есть креды получают команды ПАКЕТА
и их дочерние вызовы; ролевая сессия наследует окружение ДЕМОНА, и там токена нет с 2026-09-03T12:30:12Z
(снят `EnvironmentFile=`).

**ПОЧТА ИЗ РОЛИ ТОЖЕ НЕ ХОДИТ — замерено 2026-09-03T17:49Z, прогон curator на `077`.** Четырёх точек
`platformEnvOf` не хватает: `cli thread show --ref origin/main` делает `git fetch` и умирает первой же
командой такта — `could not read Username for 'https://github.com'`, `fatal: expected flush after ref listing`.
Роль остаётся без ЧТЕНИЯ, не только без записи.

Ход собирается руками тем же механизмом, что и пакет (`config/credentials.ts:97`), и после него живут все
команды такта, включая `--write`:
```bash
set -a; . "$(jq -r .secrets.envFile ~/.config/agent-protocol/instances/hetzner.json)"; set +a
export GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0='credential.https://github.com.helper'
export GIT_CONFIG_VALUE_0='!f() { test "$1" = get && printf "username=x-access-token\npassword=%s\n" "$GH_TOKEN"; }; f'
```

**Why:** 27 отказов «gh auth login» за три часа по восьми тредам читались как «роли тупят», а не как один
измеримый факт; сравнение двух окон журнала (0 против 27) назвало его за одну команду.

**How to apply:** такт, умерший на первой команде почты, — это НЕ «почта сломалась»: собрать хелпер строками
выше и работать. Прежде чем сказать «креды на месте» — пуш, а не чтение. Прежде чем сказать «починка
раскатана» — грепнуть, кто зовёт `platformEnvOf`: слой команд ≠ слой сессий, и даже внутри `cli` покрыты не
все пути. Постановка на второй слой — тред `065` (PR #246, `checks` зелёные 2026-09-03).
Смежно: [[green-is-only-the-runners-command]], [[merged-code-is-not-running-code]].
