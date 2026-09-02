#!/usr/bin/env bash
# Проверка правил доставки вердикта ревьюера (тред 088, постановка curator 2026-09-02,
# раздел «Проверяемость», половина «Юнит»).
#
# Гоняется ровно то, что стоило измеренных случаев: выбор флага парка (слепое
# `--park-lifted` чинило один случай из четырёх), чтение стоящего парка из отказа
# двери, поимённый учёт трёх доставок и вывод адресата хода, когда агент его не
# объявил. Сетевая половина (`deliver_to_thread`, `park_probe`) здесь НЕ гоняется —
# её закрывает интеграционный прогон против временного чекаута почты.
#
# Прогон руками: bash .github/scripts/review-delivery.test.sh
# В сьюте поднимается процессом (`src/roles/review-delivery.process.test.ts`).
set -uo pipefail

cd "$(dirname "$0")"
REVIEW_DELIVERY_DIR="$(mktemp -d)"
export REVIEW_DELIVERY_DIR
trap 'rm -rf "$REVIEW_DELIVERY_DIR"' EXIT
# shellcheck source=./review-delivery.sh
source ./review-delivery.sh

FAILED=0
check() { # <что> <ожидалось> <получено>
  if [ "$2" = "$3" ]; then
    echo "ok   · $1"
  else
    echo "FAIL · $1: ожидалось '$2', получено '$3'"
    FAILED=1
  fi
}

# --- 1. Флаг парка: четыре состояния из постановки (раздел C) -----------------

check "парка нет — без флагов" "" "$(park_flags '' 204)"
check "парк за этим кругом (run:) — письмо его снимает" \
  "--park-lifted run:204" "$(park_flags 'run:204' 204)"
check "парк за этим PR (pr:) — письмо его снимает" \
  "--park-lifted pr:204" "$(park_flags 'pr:204' 204)"
check "парк на человеке — письмо встаёт рядом" \
  "--parked-on john" "$(park_flags 'john' 204)"
# ЧУЖОЙ ПРОГОН — тот самый случай, в котором слепое `--park-lifted run:<этот PR>`
# получило бы ОТКАЗ записи (park-seen.ts:149) и потеряло письмо целиком.
check "парк за ЧУЖИМ кругом — письмо встаёт рядом, а не снимает чужое" \
  "--parked-on run:191" "$(park_flags 'run:191' 204)"
check "парк за ЧУЖИМ merge — письмо встаёт рядом" \
  "--parked-on pr:191" "$(park_flags 'pr:191' 204)"

# --- 2. Стоящий парк читается из отказа двери, а не угадывается ---------------

# Дословный отказ круга по PR #204 (прогон 33661622377) — первоисточник постановки.
REFUSAL="agent-protocol: thread '067-park-lift-narrowing' is PARKED behind the round running on PR #204 since 2026-09-02T17:33:09Z, and this message says nothing about it. Say what THIS letter does about the park: '--verdict <approve|needs-fixes> --pr 204' if it carries what the park waits for (that is what lifts it), '--parked-on run:204' if the question still stands and your letter is a report beside it, or '--park-lifted run:204' if the park is over and you are naming it as you write"
check "парк вычитан из живого отказа двери" "run:204" "$(park_value_of "$REFUSAL")"
check "парк на человеке вычитан из отказа" "john" \
  "$(park_value_of "a decision of john's, '--parked-on john' if the question still stands")"
check "отказ не про парк — значения нет" "" "$(park_value_of "new-message: --waiting-on 'nobody' is not a role")"
check "пустой текст — значения нет" "" "$(park_value_of "")"

# --- 3. Шапка verdict.md ------------------------------------------------------

VERDICT_FILE="$REVIEW_DELIVERY_DIR/verdict.md"
{
  printf 'verdict: needs-fixes\n'
  printf 'pr: 204\n'
  printf 'waiting-on: dev-core\n\n'
  printf 'Тело вердикта. Здесь может стоять слово pr: 999, и оно не якорь.\n'
} > "$VERDICT_FILE"
check "первая строка — вердикт" "needs-fixes" "$(verdict_field "$VERDICT_FILE" verdict)"
check "вторая строка — якорь PR" "204" "$(verdict_field "$VERDICT_FILE" pr)"
check "третья строка — объявленный адресат хода" "dev-core" "$(verdict_field "$VERDICT_FILE" waiting-on)"
printf 'verdict: approve\npr: 204\n' > "$VERDICT_FILE"
check "адресат не объявлен — поля нет" "" "$(verdict_field "$VERDICT_FILE" waiting-on)"
check "файла нет вовсе — поля нет" "" "$(verdict_field "$REVIEW_DELIVERY_DIR/нет.md" verdict)"

# --- 4. Адресат хода: объявлен или выведен ------------------------------------

check "объявлен агентом и существует — берётся объявленный" \
  "dev-core declared" "$(review_waiting_on 'dev-core' 1 'needs-fixes' 'dev-core' 1)"
check "объявлена несуществующая роль — правило, и это ВЫВОД" \
  "curator derived" "$(review_waiting_on 'dev-kore' 0 'approve' 'dev-core' 1)"
check "не объявлен, approve — curator (merge и есть следующий ход)" \
  "curator derived" "$(review_waiting_on '' 0 'approve' 'dev-core' 1)"
check "не объявлен, needs-fixes — автор PR" \
  "dev-core derived" "$(review_waiting_on '' 0 'needs-fixes' 'dev-core' 1)"
check "needs-fixes, а роли автора в конфиге нет — ход не передан вовсе" \
  "- none" "$(review_waiting_on '' 0 'needs-fixes' 'dev-kore' 0)"
check "needs-fixes без строки role: в описании PR — ход не передан вовсе" \
  "- none" "$(review_waiting_on '' 0 'needs-fixes' '' 0)"

# --- 5. Поимённый учёт трёх доставок ------------------------------------------

# ТОТ САМЫЙ СЛУЧАЙ (б) треда 082: вердикт уехал письмом и комментом, упал только
# статус — а страховка печатала «не сработала ни одна из трёх» прямо под вердиктом.
check "упал только статус — названо ровно то, что не доехало" \
  "доставлено: письмо в тред, коммент в PR. НЕ доставлено: формальный review-статус." \
  "$(delivery_summary ok ok failed)"
check "не доехало ничего — только тогда «ни одна из трёх»" \
  "не сработала ни одна из трёх доставок: письмо в тред, коммент в PR, формальный review-статус." \
  "$(delivery_summary failed failed failed)"
check "шаг не дошёл до доставок вовсе — тоже «ни одна из трёх»" \
  "не сработала ни одна из трёх доставок: письмо в тред, коммент в PR, формальный review-статус." \
  "$(delivery_summary none none none)"
check "всё прошло — страховка молчит по существу" \
  "все три доставки прошли: письмо в тред, коммент в PR, формальный review-статус." \
  "$(delivery_summary ok ok ok)"
check "упало письмо в тред — назван тред, а не всё сразу" \
  "доставлено: коммент в PR, формальный review-статус. НЕ доставлено: письмо в тред." \
  "$(delivery_summary failed ok ok)"

# --- 6. Учёт переживает границу шага (файлом, а не переменной) ----------------

delivery_mark comment ok
delivery_mark thread failed
check "исход доставки читается из файла" "ok" "$(delivery_state comment)"
check "отказ читается из файла" "failed" "$(delivery_state thread)"
check "доставки не было — третье состояние, а не отказ" "none" "$(delivery_state status)"

if [ "$FAILED" = "0" ]; then
  echo "доставка вердикта: все проверки прошли"
else
  echo "доставка вердикта: ЕСТЬ ПРОВАЛЫ"
  exit 1
fi
