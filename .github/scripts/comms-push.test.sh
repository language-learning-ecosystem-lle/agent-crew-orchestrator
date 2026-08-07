#!/usr/bin/env bash
# Проверка классификатора `comms_push` (тред 042-notifier-down).
#
# Логика живёт в bash внутри CI, поэтому её нельзя прогнать vitest'ом — но
# проверять в ней есть что ровно одно: РАЗЛИЧАЕТ ЛИ ОНА ДВА ОТКАЗА. Именно
# неразличение и стоило потерянной доставки 2026-08-07 (прогон 31177540774).
#
# Прогон: bash .github/scripts/comms-push.test.sh
# В джобу `checks` НЕ заведён намеренно: это добавило бы шаг в воркфлоу, от
# которого зависит зелёность каждого PR, ради теста, который гоняется руками
# при правке этого файла.
set -uo pipefail

cd "$(dirname "$0")"
# shellcheck source=./comms-push.sh
source ./comms-push.sh

FAILED=0
check() { # <что> <ожидалось> <получено>
  if [ "$2" = "$3" ]; then
    echo "ok   · $1"
  else
    echo "FAIL · $1: ожидалось '$2', получено '$3'"
    FAILED=1
  fi
}

# `sleep` подменён: тест не должен ждать реальные секунды, а величина паузы —
# как раз то, что проверяется. Вызовы идут БЕЗ подстановки команд: в субшелле
# `$( )` присваивание SLEPT не пережило бы возврат, и проверка паузы была бы
# зелёной всегда.
SLEPT=0
sleep() { SLEPT="$1"; }

STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT
PATH="$STUB_DIR:$PATH"

stub_git() { # <exit-code> <stderr>
  cat > "$STUB_DIR/git" <<EOF
#!/usr/bin/env bash
printf '%s\n' "$2" >&2
exit $1
EOF
  chmod +x "$STUB_DIR/git"
}

# 1. Успех — 0 и никакой паузы.
stub_git 0 ""
SLEPT=0
comms_push 1 > /dev/null 2>&1; RC=$?
check "успешный push возвращает 0" "0" "$RC"
check "успешный push не спит" "0" "$SLEPT"

# 2. Гонка (реальный текст git при уехавшей голове) — пауза символическая.
stub_git 1 " ! [rejected]        HEAD -> comms (fetch first)
error: failed to push some refs"
SLEPT=0
comms_push 3 > "$STUB_DIR/out" 2>&1; RC=$?; OUT="$(cat "$STUB_DIR/out")"
check "гонка возвращает 1" "1" "$RC"
check "гонка не выжидает откат" "1" "$SLEPT"
case "$OUT" in *"гонка за голову"*) echo "ok   · гонка названа гонкой";; *) echo "FAIL · гонка не названа: $OUT"; FAILED=1;; esac

# 3. Отказ сервера — ДОСЛОВНО тот, что пришёл 2026-08-07: пауза растёт.
stub_git 1 "remote: fatal error in commit_refs
 ! [remote rejected]       HEAD -> comms (failure)
error: failed to push some refs"
SLEPT=0
comms_push 3 > "$STUB_DIR/out" 2>&1; RC=$?; OUT="$(cat "$STUB_DIR/out")"
check "отказ сервера возвращает 1" "1" "$RC"
check "отказ сервера выжидает attempt*10" "30" "$SLEPT"
case "$OUT" in *"ОТКАЗ УДАЛЁННОЙ СТОРОНЫ"*) echo "ok   · отказ сервера назван отказом сервера";; *) echo "FAIL · отказ сервера принят за гонку: $OUT"; FAILED=1;; esac
case "$OUT" in *"fatal error in commit_refs"*) echo "ok   · слова удалённой стороны напечатаны дословно";; *) echo "FAIL · stderr push'а потерян: $OUT"; FAILED=1;; esac

# 4. Неопознанный отказ — лечится как серверный (ждём, а не считаем гонкой).
stub_git 1 "something nobody has seen before"
SLEPT=0
comms_push 2 > "$STUB_DIR/out" 2>&1; RC=$?; OUT="$(cat "$STUB_DIR/out")"
check "неопознанный возвращает 1" "1" "$RC"
check "неопознанный выжидает attempt*10" "20" "$SLEPT"

echo "---"
[ "$FAILED" = 0 ] && echo "все проверки пройдены" || echo "есть падения"
exit "$FAILED"
