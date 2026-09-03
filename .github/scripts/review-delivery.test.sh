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

# --- 7. Диагностика park_probe не садится в значение парка --------------------

# ЗАМЕР curator (тред 088, чтение ветки, воспроизведён): предупреждение ветви «сухой
# прогон отказал НЕ по парку» печаталось в stdout, а stdout этой функции читают
# подстановкой — поэтому текст предупреждения становился ЗНАЧЕНИЕМ парка, и письмо
# уходило с `--parked-on ::warning::…`. Дверь такое отказывает, круг снова теряет
# вердикт, а само предупреждение в лог не попадает вовсе. Гоняется настоящий
# `park_probe`: `.code` в каталоге нет, сухой прогон отказывает не по парку — ровно
# та ветвь. Сеть при этом не трогается: `cd .code` отваливается до `pnpm`.
PROBE_ERR="${REVIEW_DELIVERY_DIR}/probe.err"
PROBE_OUT="$( (cd "$REVIEW_DELIVERY_DIR" && park_probe "${REVIEW_DELIVERY_DIR}/mail" 088-нет reviewer-pr "$VERDICT_FILE") 2>"$PROBE_ERR" )"
check "отказ не по парку — stdout ПУСТ, парк не выдуман из диагностики" "" "$PROBE_OUT"
check "и флага парка из него не строится" "" "$(park_flags "$PROBE_OUT" 204)"
check "предупреждение уехало в stderr, то есть В ЛОГ прогона" "да" \
  "$(grep -q '::warning::сухой прогон new-message отказал не по парку' "$PROBE_ERR" && echo да || echo нет)"

# --- 8. Код выхода итогового шага: краснеть или нет ---------------------------

# ЗАМЕР curator (тред 088, чтение головы eef94e71): переезд доставки в шаги сделал
# итоговый шаг красным на САМОПРОПУСКЕ — класс, который тред 046 объявил зелёным и
# отсёк шагом статуса. Красный здесь = звонок смотрителя (`notifier-watch.yml` слушает
# `Claude PR Review` на `failure`) и поднятая пара `dev-core`, которой чинить нечего.
# Правило гонялось бы иначе только живым кругом ревью — отсюда предикат и эти четыре
# случая.
check "самопропуск без вердикта — ЗЕЛЁНАЯ джоба (тред 046)" \
  "0" "$(delivery_exit_code 1 0 none none none)"
check "«вердикта нет» БЕЗ самопропуска (H2, обрыв, отказ модели) — красная" \
  "1" "$(delivery_exit_code 0 0 none none none)"
check "вердикт есть, доставка неполна — красная (требование B не ослаблено)" \
  "1" "$(delivery_exit_code 0 1 ok ok failed)"
check "всё доехало — зелёная (тот самый ранний выход шага)" \
  "0" "$(delivery_exit_code 0 1 ok ok ok)"
# ГРАНИЦА ИСКЛЮЧЕНИЯ: самопропуск оправдывает молчание ревьюера, но не провал доставки
# самого сообщения о нём, и вердикта на самопропуске не бывает вовсе — если он всё же
# есть, класс уже другой и судится общим правилом.
check "самопропуск, но вердикт есть и доставка неполна — красная" \
  "1" "$(delivery_exit_code 1 1 ok ok failed)"
check "самопропуск и всё доехало — зелёная" \
  "0" "$(delivery_exit_code 1 0 ok ok ok)"

# --- 9. Переезд не потерял MAIL_REMOTE ----------------------------------------

# ЗАМЕР (сплошное сличение базы со шляпой, тред 088): базовый шаг присваивал
# `MAIL_REMOTE=` своей строкой, переезд забрал в функцию чекаут, а присваивание не
# забрал — переменная не задавалась нигде, и `${MAIL_REMOTE:?}` убил бы шаг ДО первой
# доставки в тред. Интеграционный прогон это пропустил: он зовёт дверь напрямую, минуя
# `deliver_to_thread`. Теперь функция самодостаточна, и вот на чём это держится.
check "url почты собирается из токена и репозитория" \
  "https://x-access-token:t0ken@github.com/lle/repo" \
  "$(mail_remote_url t0ken https://github.com lle/repo)"
check "схема сервера не задваивается" \
  "https://x-access-token:t0ken@ghe.local/lle/repo" \
  "$(mail_remote_url t0ken https://ghe.local lle/repo)"
# Чекаут в каталоге, где `.comms-fallback` уже есть: сети не будет (ранний выход), а
# MAIL_REMOTE обязан быть выставлен ДО него — иначе `deliver_to_thread` возьмёт пустую
# строку и пойдёт фетчить в никуда.
(
  cd "$REVIEW_DELIVERY_DIR" && mkdir -p .comms-fallback
  unset MAIL_REMOTE
  GH_TOKEN=t0ken GITHUB_SERVER_URL=https://github.com GITHUB_REPOSITORY=lle/repo review_mail_checkout
  printf '%s' "$MAIL_REMOTE" > remote.txt
)
check "MAIL_REMOTE выставлен шагом, а не yaml — и ДО раннего выхода" \
  "https://x-access-token:t0ken@github.com/lle/repo" \
  "$(cat "$REVIEW_DELIVERY_DIR/remote.txt")"
# Названный снаружи не подменяется: интеграционный прогон и локальная отладка ставят
# свой (файловый) remote, и функция обязана его уважать.
(
  cd "$REVIEW_DELIVERY_DIR"
  MAIL_REMOTE=/tmp/своя-почта
  GH_TOKEN=t0ken GITHUB_REPOSITORY=lle/repo review_mail_checkout
  printf '%s' "$MAIL_REMOTE" > remote.txt
)
check "названный снаружи MAIL_REMOTE не подменяется" "/tmp/своя-почта" \
  "$(cat "$REVIEW_DELIVERY_DIR/remote.txt")"

if [ "$FAILED" = "0" ]; then
  echo "доставка вердикта: все проверки прошли"
else
  echo "доставка вердикта: ЕСТЬ ПРОВАЛЫ"
  exit 1
fi
