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

# ВТОРАЯ ФОРМА ОТКАЗА — та, которой дверь отвечает СЕНТИНЕЛУ `park_probe` (тред 127).
# Отказ про молчание (выше) адресован ПОДНЯТОЙ СЕССИИ, и после #265 `reviewer-pr` его не
# получает вовсе — значит сегодняшняя дорога чтения парка идёт через эту форму, и она
# обязана быть измерена дословно, а не по памяти. Строки сняты с живой двери на чистом
# `main` 80908d3e (`--park-lifted probe:no-such-park` в сухом прогоне).
check "парк на человеке вычитан из отказа про сентинел" "john" \
  "$(park_value_of "agent-protocol: --park-lifted 'probe:no-such-park' — the park standing on '904-фикстура' is 'john' (a decision of john's, since 2026-09-03T00:10:00Z). Name the park you are ending, or re-read the thread: a lift declared about another park says nothing about this one")"
check "СВОЙ круг вычитан из отказа про сентинел" "run:225" \
  "$(park_value_of "agent-protocol: --park-lifted 'probe:no-such-park' — the park standing on '902-фикстура' is 'run:225' (the round running on PR #225, since 2026-09-03T00:10:00Z). Name the park you are ending, or re-read the thread: a lift declared about another park says nothing about this one")"
check "ЧУЖОЙ merge вычитан из отказа про сентинел" "pr:191" \
  "$(park_value_of "agent-protocol: --park-lifted 'probe:no-such-park' — the park standing on '906-фикстура' is 'pr:191' (the merge of PR #191, since 2026-09-03T00:10:00Z). Name the park you are ending, or re-read the thread: a lift declared about another park says nothing about this one")"
# САМ СЕНТИНЕЛ ЗНАЧЕНИЕМ ПАРКА НЕ СТАНОВИТСЯ: он стои́т в той же строке первым, и наивный
# разбор «первые кавычки после --park-lifted» вернул бы его — то есть письмо ушло бы с
# `--parked-on probe:no-such-park`, и дверь отказала бы записи. Якорь — `the park standing
# on … is`, а не близость к флагу.
check "сентинел не выдаётся за стоящий парк" "да" \
  "$(case "$(park_value_of "agent-protocol: --park-lifted 'probe:no-such-park' — the park standing on '904-ф' is 'john' (a decision of john's, since 2026-09-03T00:10:00Z)")" in "$PARK_PROBE_SENTINEL") printf 'нет' ;; *) printf 'да' ;; esac)"
# ПАРКА НЕТ — дверь на сентинел отвечает НОТОЙ и выходит нулём, то есть до разбора дело не
# доходит вовсе; но если текст ноты всё же попадёт сюда, парка в нём нет и выдумывать его
# нечего.
check "нота «ничего не запарковано» парком не притворяется" "" \
  "$(park_value_of "agent-protocol: --park-lifted 'probe:no-such-park': nothing is parked on '901-фикстура' any more — the park was lifted before this write (somebody wrote into the thread first). The message is sent as it is")"

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

# --- 6a. Отказ доставки адресуется автору PR (тред 094, решение john) ----------

# ЧИТАЕТСЯ ТО ЖЕ ПОЛЕ И ТЕМ ЖЕ СПОСОБОМ, что у уведомителей: бэктики и звёздочки вокруг
# имени поля один раз уже ослепили парсер (PR #16), поэтому оформление терпится, а второй
# формат не заводится.
check "роль автора читается из описания PR" "dev-core" \
  "$(pr_body_role 'feat: что-то

thread: 094-delivery-beside-a-foreign-park
role: dev-core
')"
check "оформление бэктиками и жирным не ослепляет" "curator" \
  "$(pr_body_role '**`role`: `curator`**')"
check "строки role нет — роли нет" "" "$(pr_body_role 'thread: 094-нечто')"
# `role:` В ТЕЛЕ, А НЕ В НАЧАЛЕ СТРОКИ, полем не является: иначе фраза «а роль: dev-core
# тут ни при чём» назначала бы адресата хода.
check "role: внутри строки полем не считается" "" "$(pr_body_role 'сказано, что role: dev-core')"

# ТЕКСТ ОТКАЗА ОБЯЗАН НАЗВАТЬ ТРИ ВЕЩИ (постановка): тред, чужой парк с номером и место,
# где висит вердикт. Проверяется каждая — их отсутствие и есть та тишина, ради которой
# правка писана.
ESC="$(escalation_body 067-park-lift-narrowing run:191 204 ok https://runs/1 dev-core)"
check "назван тред, не принявший письмо" "да" \
  "$(printf '%s' "$ESC" | grep -q '067-park-lift-narrowing' && echo да || echo нет)"
check "назван ЧУЖОЙ парк с номером" "да" \
  "$(printf '%s' "$ESC" | grep -q 'run:191' && echo да || echo нет)"
check "названо место, где висит вердикт" "да" \
  "$(printf '%s' "$ESC" | grep -q 'висит комментом в самом PR #204' && echo да || echo нет)"
check "ход назван автору PR" "да" \
  "$(printf '%s' "$ESC" | grep -q 'Ход у `dev-core` — автора PR' && echo да || echo нет)"
# КОММЕНТ МОГ И НЕ УЕХАТЬ — тогда врать о нём нельзя (болезнь треда 082: отчёт о
# доставках, разошедшийся с доставками).
ESC_NO_COMMENT="$(escalation_body 067-park-lift-narrowing pr:191 204 failed '' dev-core)"
check "коммент не доехал — про PR как место вердикта не сказано" "нет" \
  "$(printf '%s' "$ESC_NO_COMMENT" | grep -q 'ТЕКСТ ВЕРДИКТА НЕ ПОТЕРЯН' && echo да || echo нет)"
check "и сказано, где текст остался" "да" \
  "$(printf '%s' "$ESC_NO_COMMENT" | grep -q 'остался в логе шага доставки' && echo да || echo нет)"
# АДРЕСАТА МОГЛО НЕ НАЙТИСЬ — письмо всё равно едет, но молча о ходе не врёт.
check "автора нет — сказано, что ход НЕ ПЕРЕДАН" "да" \
  "$(escalation_body 067-нечто run:191 204 ok '' '' | grep -q 'Ход НЕ ПЕРЕДАН' && echo да || echo нет)"

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

# --- 10. Причина «вердикта нет» — по машинным полям транскрипта ----------------

# ЗАМЕР (тред 118, curator + чтение артефактов прогонов dev-core): у ветви «вердикта
# нет» причина уже лежала в джобе машинными полями, а письмо печатало один общий совет
# на все причины — и при 429 этот совет ВРЕДЕН (перезапуск до ресета жжёт второй круг).
# Фикстуры ниже — не выдуманные: поля скопированы из артефактов
# `reviewer-execution-239-33762234440` (429, ресет 1:40pm) и прогона 33797264710
# (здоровый круг: `is_error: false`, `terminal_reason: "completed"`).
CAUSE_DIR="$REVIEW_DELIVERY_DIR/exec"
mkdir -p "$CAUSE_DIR"
exec_fixture() { # <имя> <json последней записи> — файл вида «массив записей»
  printf '[{"type":"system","subtype":"init"},%s]\n' "$2" > "${CAUSE_DIR}/$1.json"
  printf '%s' "${CAUSE_DIR}/$1.json"
}

LIMIT_JSON='{"type":"result","subtype":"success","is_error":true,"api_error_status":429,"terminal_reason":"api_error","result":"You'"'"'ve hit your session limit · resets 1:40pm (UTC)"}'
F_LIMIT="$(exec_fixture limit "$LIMIT_JSON")"
check "429 — класс назван лимитом аккаунта" "limit" "$(review_failure_cause "$F_LIMIT")"
check "строка result процитирована ДОСЛОВНО и в дату не разобрана" \
  "You've hit your session limit · resets 1:40pm (UTC)" "$(review_failure_result "$F_LIMIT")"

F_500="$(exec_fixture api500 '{"type":"result","is_error":true,"api_error_status":500,"terminal_reason":"api_error","result":"Internal server error"}')"
check "иная ошибка API — код назван полем, а не подведён под лимит" \
  "api_error:500" "$(review_failure_cause "$F_500")"
# `429` строкой, а не числом: поле машинное, но тип его нам никто не обещал.
F_STR="$(exec_fixture str429 '{"type":"result","is_error":true,"api_error_status":"429","terminal_reason":"api_error"}')"
check "429 строкой — тот же класс" "limit" "$(review_failure_cause "$F_STR")"

F_TURNS="$(exec_fixture turns '{"type":"result","subtype":"error_max_turns","is_error":true,"api_error_status":null,"terminal_reason":"max_turns","result":"Reached maximum turns"}')"
check "обрыв по ходам — причина названа полем как есть" \
  "max_turns" "$(review_failure_cause "$F_TURNS")"
F_ERR="$(exec_fixture bare '{"type":"result","is_error":true,"result":"что-то пошло не так"}')"
check "различимо только is_error — так и сказано" "error" "$(review_failure_cause "$F_ERR")"

# ЗДОРОВЫЙ КРУГ, В КОТОРОМ ВЕРДИКТА ВСЁ РАВНО НЕТ (дефект H2): причины НЕ ВИДНО, и
# выдумывать её нельзя — письмо печатает сегодняшний общий текст.
F_OK="$(exec_fixture completed '{"type":"result","subtype":"success","is_error":false,"api_error_status":null,"terminal_reason":"completed","result":"Verdict written"}')"
check "круг завершился штатно — причины нет, догадка не строится" "" "$(review_failure_cause "$F_OK")"

# ТРИ СПОСОБА НЕ ИМЕТЬ ДАННЫХ — все три молчат, а не гадают (требование 5 постановки).
check "файла нет — причины нет" "" "$(review_failure_cause "${CAUSE_DIR}/нет.json")"
check "имя файла пустое (execution_file пуст) — причины нет" "" "$(review_failure_cause "")"
: > "${CAUSE_DIR}/empty.json"
check "файл пуст — причины нет" "" "$(review_failure_cause "${CAUSE_DIR}/empty.json")"
printf 'не json вовсе\n' > "${CAUSE_DIR}/garbage.json"
check "файл не разбирается — причины нет" "" "$(review_failure_cause "${CAUSE_DIR}/garbage.json")"
check "и строки result из него тоже нет" "" "$(review_failure_result "${CAUSE_DIR}/garbage.json")"
printf '[]\n' > "${CAUSE_DIR}/empty-array.json"
check "записей ноль — причины нет" "" "$(review_failure_cause "${CAUSE_DIR}/empty-array.json")"
# Одиночная запись объектом, а не массивом: форма файла тоже не обещана.
printf '%s\n' "$LIMIT_JSON" > "${CAUSE_DIR}/single.json"
check "запись одна и не в массиве — класс тот же" "limit" "$(review_failure_cause "${CAUSE_DIR}/single.json")"
# ПОСЛЕДНЯЯ запись, а не первая попавшаяся: 429 в середине переживается ретраем внутри
# сессии, и судить по нему круг, дошедший до конца, — назвать неверную причину.
printf '[{"type":"result","is_error":true,"api_error_status":429},%s]\n' \
  '{"type":"result","is_error":false,"terminal_reason":"completed"}' > "${CAUSE_DIR}/mid.json"
check "429 в середине, а конец штатный — причины нет" "" "$(review_failure_cause "${CAUSE_DIR}/mid.json")"

# --- 10. Адресация эскалации: слаг, а не имя каталога (тред 125) --------------

# ПОЧЕМУ ЭТО ГОНЯЕТСЯ ЗДЕСЬ, А ВЫБОР ПРИЁМНИКА — НЕТ. Выбор приёмника у стоячего
# адреса делает ДВЕРЬ (`--ensure-thread`), и второго его разбора в этом файле нет
# намеренно (см. шапку `address_flags`): гонять здесь нечего, кроме того, что дверь
# спрошена ПРАВИЛЬНО. Сам выбор гоняет сюита ДВЕРИ, а не этот файл и не
# интеграционный прогон: `src/thread/receiver.test.ts` (открытый приёмник /
# закрытый → открывается следующий / приёмника этого адреса нет вовсе / номер
# вместо слага — отказ по имени) и `src/thread/ensure-thread.process.test.ts`
# (тот же выбор живой командой). Стык «этот файл ↔ раскладка почты» на БОЕВЫХ
# именах замерен отдельно и в код не носится — замер в треде 125.
ADDR_ESC="$(address_flags "address:notifier-down")"
check "стоячий адрес спрашивается флагом --ensure-thread" "да" \
  "$(printf '%s' "$ADDR_ESC" | grep -qx -- '--ensure-thread' && echo да || echo нет)"
check "и слаг едет БЕЗ номера — номер выдаёт сама дверь" "да" \
  "$(printf '%s' "$ADDR_ESC" | grep -qx -- 'notifier-down' && echo да || echo нет)"
check "именованный тред остаётся --thread" "--thread
067-park-lift-narrowing" "$(address_flags 067-park-lift-narrowing)"
# ПО ОДНОМУ АРГУМЕНТУ НА СТРОКУ — не украшение: заголовок приёмника несёт пробел, и
# словоделением он приехал бы к двери четырьмя аргументами. Считается ЧИСЛО и само
# значение, потому что «шесть строк» ещё не значит «шесть аргументов».
mapfile -t ADDR_ARGS <<<"$ADDR_ESC"
check "флагов ровно шесть — заголовок не расклеен по пробелу" "6" "${#ADDR_ARGS[@]}"
check "заголовок приёмника — ОДИН аргумент" "Стоячий адрес: отказ уведомителя" "${ADDR_ARGS[3]}"
check "состав приёмника назван и он тот же, что у смотрителя" "github,dev-core,curator" \
  "${ADDR_ARGS[5]}"
# ПУСТОЙ АДРЕС — ОТКАЗ ПО ИМЕНИ, а не письмо в никуда.
ADDR_ERR="${REVIEW_DELIVERY_DIR}/addr.err"
# Пустой адрес убивает вызов на `${1:?}` (в неинтерактивном bash это не «код возврата»,
# а немедленная смерть подоболочки) — поэтому и гоняется он подоболочкой.
check "адрес пуст — отказ" "1" "$( (address_flags '') 2>"$ADDR_ERR" >/dev/null; echo $?)"
check "и он назван по имени" "да" \
  "$(grep -q 'address_flags: не назван адрес' "$ADDR_ERR" && echo да || echo нет)"
check "'address:' без слага — отказ" "1" \
  "$(address_flags 'address:' 2>"$ADDR_ERR" >/dev/null; echo $?)"
check "и он тоже назван" "да" \
  "$(grep -q 'стоячий адрес не назван' "$ADDR_ERR" && echo да || echo нет)"

# ФАКТИЧЕСКИЙ ПРИЁМНИК ЧИТАЕТСЯ ИЗ ДЕРЕВА — у стоячего адреса он мог быть ОТКРЫТ этой
# же записью, и его номер иначе не узнать ниоткуда.
check "новый приёмник (untracked) — назван" "126-notifier-down" \
  "$(landed_thread '?? agent-comms/126-notifier-down/_meta.md
?? agent-comms/126-notifier-down/messages/2026-09-04T10-00-00Z-reviewer-pr.md')"
check "существующий приёмник (одно письмо) — назван" "077-notifier-down" \
  "$(landed_thread '?? agent-comms/077-notifier-down/messages/2026-09-04T10-00-00Z-reviewer-pr.md')"
check "имя в кавычках (не-ASCII слаг фикстуры) — назван без кавычки" "911-фикстура" \
  "$(landed_thread '?? "agent-comms/911-фикстура/messages/письмо.md"')"
# ПРОИЗВОДНЫЙ INDEX ТРЕДОМ НЕ ЯВЛЯЕТСЯ: он лежит не под `NNN-`, и принять его за
# приёмник значило бы назвать читателю лога файл вместо треда.
check "изменился только INDEX — приёмника нет" "" \
  "$(landed_thread ' M agent-comms/INDEX.md')"
check "дерево не тронуто — приёмника нет" "" "$(landed_thread '')"

# ЗАМОК — НА АДРЕСЕ, А НЕ НА КАТАЛОГЕ, и второй шаг доставки называет ФАКТИЧЕСКИЙ
# приёмник первого письма. Сеть здесь не трогается: ветвь замка отвечает до неё.
printf '126-notifier-down\n' > "${REVIEW_DELIVERY_DIR}/escalated"
LOCKED="$(escalate_undelivered 067-park-lift-narrowing run:191 204)"
check "второе письмо в стоячий адрес не шлётся" "да" \
  "$(printf '%s' "$LOCKED" | grep -q 'второго письма в стоячий адрес не шлём' && echo да || echo нет)"
check "и назван ТРЕД, в котором письмо лежит, а не слаг" "да" \
  "$(printf '%s' "$LOCKED" | grep -q 'приёмник 126-notifier-down' && echo да || echo нет)"
check "адрес назван рядом с приёмником" "да" \
  "$(printf '%s' "$LOCKED" | grep -q "адрес 'notifier-down'" && echo да || echo нет)"
# ПЕРВОЕ ПИСЬМО МОГЛО И НЕ ЛЕЧЬ — тогда приёмника нет, и номер не выдумывается.
: > "${REVIEW_DELIVERY_DIR}/escalated"
check "первое письмо не легло — приёмник НЕ НАЗВАН, а не выдуман" "да" \
  "$(escalate_undelivered 067-park-lift-narrowing run:191 204 \
     | grep -q 'приёмник НЕ НАЗВАН: первое письмо не легло' && echo да || echo нет)"
rm -f "${REVIEW_DELIVERY_DIR}/escalated"

# --- 11. Литерала приёмника в коде нет ни в каком виде ------------------------

# Требование 1 постановки 125: `077-notifier-down` не остаётся в файле нигде, включая
# значение по умолчанию и прозу шапок. Чистый греп бывает чистым по кривому шаблону —
# поэтому рядом два контроля: шаблон ловит форму, которую ищет, и читается ТОТ файл.
check "номера приёмника в коде нет" "" "$(grep -nE '[0-9]{3}-notifier-down' ./review-delivery.sh)"
check "контроль: шаблон ловит ту самую форму" "да" \
  "$(printf 'X="077-notifier-down"\n' | grep -qE '[0-9]{3}-notifier-down' && echo да || echo нет)"
check "контроль: греп читает тот самый файл" "да" \
  "$(grep -qF 'REVIEW_ESCALATION_ADDRESS' ./review-delivery.sh && echo да || echo нет)"
check "и старого имени переменной, за которым читатель искал бы номер, тоже нет" "" \
  "$(grep -n 'REVIEW_ESCALATION_THREAD' ./review-delivery.sh)"

if [ "$FAILED" = "0" ]; then
  echo "доставка вердикта: все проверки прошли"
else
  echo "доставка вердикта: ЕСТЬ ПРОВАЛЫ"
  exit 1
fi
