#!/usr/bin/env bash
# Проверка правила глушения `notifier_mute_decide` (тред 073, постановка curator
# 2026-09-02: «повторный отказ ОДНОГО и того же уведомителя не должен рождать
# письмо каждый раз»).
#
# Фикстура — каталог `messages/` треда-приёмника с письмами того вида, который
# кладёт сам смотритель: имя файла несёт время, тело — строку-ключ. Проверяется
# ровно то, что стоило девяти писем за тринадцать минут: ДВА ОДИНАКОВЫХ ОТКАЗА
# ПОДРЯД дают одно письмо, а не два.
#
# Прогон руками: bash .github/scripts/notifier-mute.test.sh
# В сьюте он же поднимается процессом (`src/roles/notifier-mute.process.test.ts`)
# — в отличие от `comms-push.test.sh`, оставленного ручным: там правило гоняется
# при правке файла, а здесь правило решает, поедет ли письмо, и молчаливо
# сломанное оно неотличимо от исправного.
set -uo pipefail

cd "$(dirname "$0")"
# shellcheck source=./notifier-mute.sh
source ./notifier-mute.sh

FAILED=0
check() { # <что> <ожидалось> <получено>
  if [ "$2" = "$3" ]; then
    echo "ok   · $1"
  else
    echo "FAIL · $1: ожидалось '$2', получено '$3'"
    FAILED=1
  fi
}

DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
MESSAGES="$DIR/messages"
mkdir -p "$MESSAGES"

letter() { # <метка в имени файла> <имя уведомителя>
  {
    printf '🔕 **Уведомитель `%s` отказал: `failure`.**\n\n' "$2"
    printf '%s · окно %s с\n' "$(notifier_mute_marker "$2")" "$NOTIFIER_MUTE_WINDOW_SEC"
  } > "$MESSAGES/$1-github.md"
}

# 1. Первый отказ — писать всегда: тред о нём ещё ничего не знает.
check "письма об уведомителе нет — письмо едет" \
  "deliver - -" "$(notifier_mute_decide "$MESSAGES" 'Comms Derived' '2026-09-02T16:39:00Z')"

# 2. ВТОРОЙ ОДИНАКОВЫЙ ОТКАЗ ПОДРЯД — тот самый случай петли: письмо уже лежит,
#    прошло полминуты. Ожидается глушение с названным возрастом.
letter '2026-09-02T16-39-00Z' 'Comms Derived'
check "повтор через 30 с — заглушён" \
  "mute 2026-09-02T16:39:00Z 30" "$(notifier_mute_decide "$MESSAGES" 'Comms Derived' '2026-09-02T16:39:30Z')"

# 3. Окно кончилось — письмо снова едет, и метка прошлого письма отдаётся
#    наружу: ею считается число заглушённых для громкой строки.
check "через 15 мин 1 с — письмо едет" \
  "deliver 2026-09-02T16:39:00Z 901" "$(notifier_mute_decide "$MESSAGES" 'Comms Derived' '2026-09-02T16:54:01Z')"
check "ровно на границе окна — письмо едет" \
  "deliver 2026-09-02T16:39:00Z 900" "$(notifier_mute_decide "$MESSAGES" 'Comms Derived' '2026-09-02T16:54:00Z')"

# 4. ДРУГОЙ уведомитель молчанием соседа не глушится: ключ — имя, и он различает.
check "другой уведомитель в том же окне — письмо едет" \
  "deliver - -" "$(notifier_mute_decide "$MESSAGES" 'Merge Notify' '2026-09-02T16:39:30Z')"

# 5. Из двух писем берётся ПОСЛЕДНЕЕ, а не первое попавшееся: серия в треде
#    длиннее одного письма, и решать по старшему значило бы разглушиться зря.
letter '2026-09-02T16-52-25Z' 'Comms Derived'
check "решает последнее письмо, а не первое" \
  "mute 2026-09-02T16:52:25Z 34" "$(notifier_mute_decide "$MESSAGES" 'Comms Derived' '2026-09-02T16:52:59Z')"

# 6. Отказ читается в сторону письма, а не тишины.
check "письмо из будущего (часы разъехались) — письмо едет" \
  "deliver 2026-09-02T16:52:25Z -145" "$(notifier_mute_decide "$MESSAGES" 'Comms Derived' '2026-09-02T16:50:00Z')"
check "пустой каталог — письмо едет" \
  "deliver - -" "$(notifier_mute_decide "$DIR/нет-такого" 'Comms Derived' '2026-09-02T16:39:30Z')"

# 7. Окно — параметр правила, а не константа внутри него: письмо той же
#    давности при коротком окне уже не глушится.
check "окно передано явно — правило считает по нему" \
  "deliver 2026-09-02T16:52:25Z 34" "$(notifier_mute_decide "$MESSAGES" 'Comms Derived' '2026-09-02T16:52:59Z' 10)"

# 8. ВЫБОР ЛЕНТЫ У СТОЯЧЕГО АДРЕСА (тред 080). Приёмник — не литерал: адрес
#    исполняют обычные треды по очереди, и правило обязано читать ленту того,
#    кто играет его СЕЙЧАС, иначе оно заглушит звонок серией из закрытого.
MAIL="$DIR/mail"
mkdir -p "$MAIL"
receiver() { # <id треда> <status>
  mkdir -p "$MAIL/$1/messages"
  printf -- '---\ntitle: Стоячий адрес\nparticipants: github, dev-core\nstatus: %s\n---\n' "$2" \
    > "$MAIL/$1/_meta.md"
}

check "приёмника у адреса нет вовсе — ленты нет, письмо поедет и откроет его" \
  "" "$(notifier_mute_source "$MAIL" 'notifier-down')"

receiver '077-notifier-down' open
check "единственный открытый приёмник — его лента" \
  "$MAIL/077-notifier-down/messages" "$(notifier_mute_source "$MAIL" 'notifier-down')"

# Старший по номеру, а не первый попавшийся: адрес переезжает вперёд.
receiver '104-notifier-down' open
check "открытых несколько — старший по номеру" \
  "$MAIL/104-notifier-down/messages" "$(notifier_mute_source "$MAIL" 'notifier-down')"

# ЗАКРЫТЫЙ ПРИЁМНИК ЛЕНТЫ НЕ ОТДАЁТ — ровно тот случай, ради которого функция и
# написана: письмо поедет в новый приёмник, а серия закрытого заглушила бы его.
receiver '104-notifier-down' closed
check "старший закрыт — читается открытый, что ниже номером" \
  "$MAIL/077-notifier-down/messages" "$(notifier_mute_source "$MAIL" 'notifier-down')"

receiver '077-notifier-down' closed
check "все приёмники закрыты — ленты нет, звонок не глушится" \
  "" "$(notifier_mute_source "$MAIL" 'notifier-down')"

# Чужой адрес соседним слагом не отвечает: слаг — это и есть имя адреса.
receiver '076-main-red-alarm' open
check "слаг различает адреса" \
  "" "$(notifier_mute_source "$MAIL" 'notifier-down')"
check "слаг соседнего адреса отдаёт свою ленту" \
  "$MAIL/076-main-red-alarm/messages" "$(notifier_mute_source "$MAIL" 'main-red-alarm')"

# Тред без `_meta.md` не кандидат — по той же причине, по которой его пропускает
# дверь: ленту, которую некому прочитать, судить нечем.
mkdir -p "$MAIL/091-notifier-down/messages"
check "приёмник без _meta.md пропускается" \
  "" "$(notifier_mute_source "$MAIL" 'notifier-down')"

# 9. СТЫК ДВУХ ПРАВИЛ: лента выбранного приёмника — это то, по чему решает
#    глушение. Проверяется вместе, потому что порознь обе половины зелены и в
#    том случае, когда воркфлоу читает не тот тред.
receiver '108-notifier-down' open
{
  printf '🔕 **Уведомитель `%s` отказал: `failure`.**\n\n' 'Comms Derived'
  printf '%s · окно %s с\n' "$(notifier_mute_marker 'Comms Derived')" "$NOTIFIER_MUTE_WINDOW_SEC"
} > "$MAIL/108-notifier-down/messages/2026-09-03T16-39-00Z-github.md"
check "решение принимается по ленте выбранного приёмника" \
  "mute 2026-09-03T16:39:00Z 30" \
  "$(notifier_mute_decide "$(notifier_mute_source "$MAIL" 'notifier-down')" 'Comms Derived' '2026-09-03T16:39:30Z')"

if [ "$FAILED" = 0 ]; then
  echo "правило глушения: все проверки прошли"
else
  echo "правило глушения: ЕСТЬ ОТКАЗЫ"
fi
exit "$FAILED"
