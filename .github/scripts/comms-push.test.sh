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

# ЗАГЛУШКА `git` РАЗБИРАЕТ ПОДКОМАНДУ, А НЕ ОТВЕЧАЕТ ОДНИМ КОДОМ НА ВСЁ. До треда
# 137 дверь звала git ровно один раз, и одного кода хватало; теперь она спрашивает
# факт (`rev-parse`, `fetch`, `merge-base`), и заглушка «один код на все вызовы»
# отвечала бы за пробу тем же, чем за push — то есть проверяла бы не то.
#
# РАЗБОР — ПО ПЕРВОМУ СЛОВУ, НЕ НАЧИНАЮЩЕМУСЯ С '-', И С ПРОПУСКОМ ЗНАЧЕНИЯ `-C`:
# дверь зовёт и `git push`, и `git -C <дир> push` (так её зовёт `review-delivery.sh`),
# и стенд, судящий по ПОЗИЦИИ аргумента, промахнулся бы мимо второй формы молча.
stub_git() { # <код push> <stderr push> [код rev-parse] [код fetch] [код merge-base]
  local push_rc="$1" push_err="$2" rev_rc="${3:-0}" fetch_rc="${4:-0}" mb_rc="${5:-1}"
  cat > "$STUB_DIR/git" <<EOF
#!/usr/bin/env bash
sub=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -C|-c) shift 2 ;;
    -*) shift ;;
    *) sub="\$1"; break ;;
  esac
done
case "\$sub" in
  push)       printf '%s\n' "$push_err" >&2; exit $push_rc ;;
  rev-parse)  [ "$rev_rc" = 0 ] && echo "1111111111111111111111111111111111111111" \\
                                || echo "fatal: Needed a single revision" >&2
              exit $rev_rc ;;
  fetch)      [ "$fetch_rc" = 0 ] || echo "fatal: could not read from remote repository" >&2
              exit $fetch_rc ;;
  merge-base) [ "$mb_rc" -le 1 ] || echo "fatal: Not a valid commit name FETCH_HEAD" >&2
              exit $mb_rc ;;
  *)          exit 0 ;;
esac
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

# ПОТЕРЯННАЯ КВИТАНЦИЯ (тред 137) — push отчитался провалом, но коммит УЖЕ на
# удалённой голове. Три случая ниже и есть предмет: без них дверь судит доставку
# кодом выхода клиента, а вызывающий цикл кладёт ВТОРОЕ письмо того же прогона.

# 5. Квитанция потеряна — 0, без паузы, и сказано отдельной строкой.
stub_git 1 "remote: fatal error in commit_refs
 ! [remote rejected]       HEAD -> comms (failure)
error: failed to push some refs" 0 0 0
SLEPT=0
comms_push 3 > "$STUB_DIR/out" 2>&1; RC=$?; OUT="$(cat "$STUB_DIR/out")"
check "потерянная квитанция возвращает 0" "0" "$RC"
check "потерянная квитанция не выжидает паузу" "0" "$SLEPT"
case "$OUT" in *"КВИТАНЦИЯ ПОТЕРЯНА"*) echo "ok   · потерянная квитанция названа в логе";; *) echo "FAIL · потерянная квитанция не названа: $OUT"; FAILED=1;; esac
case "$OUT" in *"fatal error in commit_refs"*) echo "ok   · показания сервера напечатаны и на этой ветви";; *) echo "FAIL · stderr push'а потерян: $OUT"; FAILED=1;; esac
case "$OUT" in *"ОТКАЗ УДАЛЁННОЙ СТОРОНЫ"*) echo "FAIL · доставленный push всё равно классифицирован как отказ: $OUT"; FAILED=1;; *) echo "ok   · классификация до доставленного push'а не доходит";; esac

# 6. Гонка НЕ съедена: проба отвечает честное «нет», и ветвь остаётся сегодняшней.
stub_git 1 " ! [rejected]        HEAD -> comms (fetch first)
error: failed to push some refs" 0 0 1
SLEPT=0
comms_push 3 > "$STUB_DIR/out" 2>&1; RC=$?; OUT="$(cat "$STUB_DIR/out")"
check "гонка при живой пробе возвращает 1" "1" "$RC"
check "гонка при живой пробе выжидает 1 с" "1" "$SLEPT"
case "$OUT" in *"гонка за голову"*) echo "ok   · гонка по-прежнему названа гонкой";; *) echo "FAIL · проба съела лечение гонки: $OUT"; FAILED=1;; esac

# 7. Проба НЕ ИЗМЕРИЛА — это «не доставлено», а не «доставлено». Три осечки:
#    отказ `fetch`, отсутствие `HEAD`, нечитаемый ответ `merge-base`.
SERVER_ERR="remote: fatal error in commit_refs
 ! [remote rejected]       HEAD -> comms (failure)"

stub_git 1 "$SERVER_ERR" 0 1 0   # fetch падает, а merge-base сказал бы «да»
SLEPT=0
comms_push 3 > "$STUB_DIR/out" 2>&1; RC=$?; OUT="$(cat "$STUB_DIR/out")"
check "отказ fetch'а в пробе возвращает 1" "1" "$RC"
check "отказ fetch'а в пробе оставляет паузу attempt*10" "30" "$SLEPT"
case "$OUT" in *"проба потерянной квитанции не состоялась (git fetch)"*) echo "ok   · осечка пробы названа по имени (fetch)";; *) echo "FAIL · осечка пробы не названа: $OUT"; FAILED=1;; esac

stub_git 1 "$SERVER_ERR" 1 0 0   # нет HEAD, а merge-base сказал бы «да»
SLEPT=0
comms_push 2 > "$STUB_DIR/out" 2>&1; RC=$?; OUT="$(cat "$STUB_DIR/out")"
check "отсутствие HEAD в пробе возвращает 1" "1" "$RC"
check "отсутствие HEAD в пробе оставляет паузу attempt*10" "20" "$SLEPT"
case "$OUT" in *"проба потерянной квитанции не состоялась (нет HEAD)"*) echo "ok   · осечка пробы названа по имени (HEAD)";; *) echo "FAIL · осечка пробы не названа: $OUT"; FAILED=1;; esac

stub_git 1 "$SERVER_ERR" 0 0 128 # merge-base ответил не «да» и не «нет»
SLEPT=0
comms_push 2 > "$STUB_DIR/out" 2>&1; RC=$?; OUT="$(cat "$STUB_DIR/out")"
check "нечитаемый ответ merge-base возвращает 1" "1" "$RC"
check "нечитаемый ответ merge-base оставляет паузу attempt*10" "20" "$SLEPT"
case "$OUT" in *"проба потерянной квитанции не состоялась (git merge-base, код 128)"*) echo "ok   · осечка пробы названа по имени (merge-base)";; *) echo "FAIL · осечка пробы не названа: $OUT"; FAILED=1;; esac

echo "---"
[ "$FAILED" = 0 ] && echo "все проверки пройдены" || echo "есть падения"
exit "$FAILED"
