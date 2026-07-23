#!/usr/bin/env bash
# P0-спайк: доказать, что headless-агент проходит ПОЛНЫЙ цикл протокола
# agent-comms, а не только отвечает как команда (тред 012, фаза P0).
#
# Что доказывается одним прогоном:
#   почта (has-mail) → `claude -p` с промптом роли → агент читает тред,
#   дописывает секцию, перегенерирует реестр, коммитит и пушит → процесс
#   выходит кодом. Без tmux, без живой вахты, без /wake.
#
# Если это работает — из модели исполнения исчезает целый слой (tmux-сессия,
# `wait-for-mail`, сторож-как-будильник), а с ним класс багов «сессия жива ≠
# агент видит почту» (боль 5, тред 008): в модели «пробуждение = новый процесс»
# его просто нет.
#
# БЕЗОПАСНОСТЬ. Спайк работает ТОЛЬКО в изолированной песочнице (свой bare-origin
# в $TMPDIR, своя ветка comms-копия) и НЕ прикасается к боевому контуру. Это
# честное доказательство механики (настоящий формат секций, настоящий git
# push, настоящий rebuild-index), но на выброшенных данных.
#
# usage: bash headless-cycle.sh
# требует: git, claude CLI (проверено на 2.1.218), доступ к модели.

set -uo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SPIKE_DIR/../../.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

log() { printf '\n=== %s\n' "$*"; }

# Боевой протокол живёт в отдельном чекауте `.worktrees/comms`, откуда спайк
# берёт rebuild-index.sh и ROLES.md. Путь ищем ЯВНО и падаем ГРОМКО, если не
# нашли: молчаливая деградация подготовки стенда (`cp … 2>/dev/null`) один раз
# уже дала ложную картину — агент увидел пустой bin/, не смог передать ход
# генератором и импровизировал, а провал списался бы на «агент недетерминирован».
# Урок cwd/has-mail (тред 008): стенд кричит, а не молчит.
COMMS_DIR=""
for cand in "$REPO_ROOT/.worktrees/comms/agent-comms" "$REPO_ROOT/../comms/agent-comms"; do
  [ -f "$cand/bin/rebuild-index.sh" ] && { COMMS_DIR="$cand"; break; }
done
if [ -z "$COMMS_DIR" ]; then
  echo "ОШИБКА: не нашёл боевой agent-comms с bin/rebuild-index.sh (искал в .worktrees/comms и ../comms)" >&2
  exit 2
fi
log "Боевой протокол: $COMMS_DIR"

# Бинарь claude РЕЗОЛВИМ ЯВНО, а не зовём по имени. PATH под-шелла нестабилен
# между вызовами (nvm-bin то есть, то нет), и голый `claude` давал exit 127
# посреди прогона — тот же класс «молчаливая зависимость от окружения», что
# cwd у has-mail. Ищем в PATH, затем в известном nvm-пути; нет нигде — падаем
# ГРОМКО ДО запуска цикла, а не невнятным 127 в середине.
CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
if [ -z "$CLAUDE_BIN" ]; then
  for cand in "$HOME"/.nvm/versions/node/*/bin/claude; do
    [ -x "$cand" ] && { CLAUDE_BIN="$cand"; break; }
  done
fi
if [ -z "$CLAUDE_BIN" ]; then
  echo "ОШИБКА: не нашёл бинарь claude ни в PATH, ни в ~/.nvm/versions/node/*/bin" >&2
  exit 3
fi
log "claude: $CLAUDE_BIN"

# --- 1. Изолированный стенд с тредом, ждущим dev-core ---
log "Строю песочницу: $SANDBOX"
git init -q --bare "$SANDBOX/origin.git"
git clone -q "$SANDBOX/origin.git" "$SANDBOX/work"
cd "$SANDBOX/work"
git config user.email spike@test
git config user.name spike

mkdir -p agent-comms/900-spike agent-comms/bin
cp "$COMMS_DIR/bin/rebuild-index.sh" agent-comms/bin/
cp "$COMMS_DIR/ROLES.md" agent-comms/

cat > agent-comms/INDEX.md <<'IDX'
# Реестр разговоров

| id | participants | status | waiting-on | updated |
|---|---|---|---|---|
| 900-spike | curator, dev-core | open | dev-core | 2026-07-23 |
IDX

cat > agent-comms/900-spike/_thread.md <<'THR'
# 900-spike · Проверка headless-цикла

participants: curator, dev-core · status: open

## msg-001 · from: curator · 2026-07-23 · expects: answer

dev-core, это спайк-проверка. Ответь секцией msg-002 в конец этого треда:
подтверди, что прочитал постановку, и напиши число 42. Затем передай ход
обратно куратору строкой waiting-on.
THR

git checkout -q -b comms
git add -A
git commit -qm "spike stand init"
# Код возврата проверяем, вывод НЕ глушим (замечание ревьюера по PR #17): молчать
# на push стенда — тот же паттерн `… 2>/dev/null`, который спайк сам называет
# причиной одного из дефектов харнесса. Принцип «стенд кричит, а не молчит»
# соблюдаем и здесь, а не только на резолве COMMS_DIR/CLAUDE_BIN.
if ! git push -q -u origin comms; then
  echo "ОШИБКА: push стенда в bare-origin не прошёл — дальше цикл проверять не на чем" >&2
  exit 4
fi

# --- 2. Проверка почты тем же разбором, что у боевого контура ---
# (Здесь has-mail не тащим: тред очевидно ждёт dev-core. В боевом обёртка
#  запускает claude ТОЛЬКО когда has-mail непуст — это и есть триггер.)
log "Почта: 900-spike ждёт dev-core"

# --- 3. Headless-агент проходит цикл ---
PROMPT='Ты — роль dev-core в файловом протоколе agent-comms. Рабочая директория — git-репозиторий, ветка comms.

Задача одного цикла:
1. Прочитай agent-comms/900-spike/_thread.md — там постановка от curator.
2. Отработай её: допиши в КОНЕЦ файла секцию ровно в формате
   ## msg-002 · from: dev-core · 2026-07-23 · expects: answer
   с текстом ответа по постановке. Треды append-only — существующее не трогай, дописывай в конец.
3. Прогони bash agent-comms/bin/rebuild-index.sh чтобы обновить agent-comms/INDEX.md (передай ход обратно: в своей секции строкой "waiting-on → curator").
4. Закоммить и запушь: git add -A && git commit -m "docs(agent-comms): msg-002 в 900-spike — ответ dev-core" && git push origin HEAD:comms
5. Кратко подтверди, что цикл выполнен.'

log "Запуск headless-агента (claude -p, лимит 180с)"
timeout 180 "$CLAUDE_BIN" -p "$PROMPT" \
  --output-format json \
  --allowedTools "Bash,Read,Edit,Write" \
  --max-turns 25 > "$SANDBOX/run.json" 2>"$SANDBOX/run.err"
CLAUDE_EXIT=$?

# --- 4. Проверка ФАКТОМ (не рапортом агента) ---
log "Проверка результата в origin"
git fetch -q origin comms
THREAD="$(git show origin/comms:agent-comms/900-spike/_thread.md)"
INDEX="$(git show origin/comms:agent-comms/INDEX.md)"

pass=0 fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1 (ждали '$3', получили '$2')"; fail=$((fail+1)); fi; }

check "процесс вышел кодом 0"          "$CLAUDE_EXIT" "0"
check "msg-002 записан агентом"        "$(printf '%s' "$THREAD" | grep -c 'msg-002 · from: dev-core')" "1"
check "msg-001 сохранён (append-only)" "$(printf '%s' "$THREAD" | grep -c 'msg-001 · from: curator')" "1"
check "ход передан curator в INDEX"    "$(printf '%s' "$INDEX" | awk -F'|' '/900-spike/{gsub(/ /,"",$5);print $5}')" "curator"

python3 - "$SANDBOX/run.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(f"  · is_error={d['is_error']} subtype={d.get('subtype')} turns={d.get('num_turns')}")
print(f"  · session_id={d.get('session_id')}")
print(f"  · cost_usd={d.get('total_cost_usd')} duration_ms={d.get('duration_ms')}")
PY

log "Итог: $pass пройдено, $fail провалено"
[ "$fail" -eq 0 ] && echo "P0 ДОКАЗАН: headless-агент проходит полный цикл протокола." || echo "P0 НЕ доказан — см. провалы выше."
exit "$fail"
