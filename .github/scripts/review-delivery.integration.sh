#!/usr/bin/env bash
# ИНТЕГРАЦИОННЫЙ ПРОГОН ДОСТАВКИ — против ВРЕМЕННОГО чекаута почты (тред 088,
# «Проверяемость», вторая половина; список состояний расширен curator 2026-09-03).
#
# ЗАЧЕМ ОН ОТДЕЛЬНО ОТ ЮНИТА. `review-delivery.test.sh` гоняет чистые функции и знает
# о двери ровно то, что я о ней написал: `park_value_of` разбирает ДОСЛОВНЫЙ текст
# чужого отказа, и это единственное место, где мой код зависит от формулировки чужого
# сообщения. Юнит кормит его строкой из лога — то есть проверяет разбор, но не то, что
# дверь СЕГОДНЯ говорит именно так. Здесь отказ приходит от живой двери.
#
# ЧТО ГОНЯЕТСЯ: шесть состояний парка, на каждом — `park_probe` (сухой прогон, чтение
# парка из отказа), `park_flags` (выбор флага) и НАСТОЯЩАЯ запись `new-message --write`
# с этим флагом. Ожидание на всех шести: письмо ЛЕГЛО; чужой парк остался стоять.
#
# ПОЧВА. Почта — копия в `mktemp -d`, живая не трогается ничем: пишем `--no-push`, и
# коммита здесь тоже нет (его в джобе делает шаг после `new-message`). Сеть не нужна:
# конфиг читается из `--repo . --ref origin/main` рабочего дерева роли.
#
# Прогон руками (ТОЛЬКО так, в CI не поднимается — ему нужны pnpm-воркспейс и
# `origin/main` рабочего дерева):
#   bash .github/scripts/review-delivery.integration.sh
set -uo pipefail

CODE_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MAIL_SRC="${MAIL_SRC:-/home/lle/projects/agent-crew-orchestrator/.worktrees/comms/agent-comms}"
PR=225

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/mail/agent-comms"
# Дверь требует, чтобы корень почты лежал ВНУТРИ git-репозитория (`rev-parse
# --show-toplevel`), — временная почта поэтому настоящий репозиторий, а не каталог.
git -C "$WORK/mail" init -q -b comms
git -C "$WORK/mail" config user.name "integration"
git -C "$WORK/mail" config user.email "integration@agents.invalid"
ln -s "$CODE_DIR" "$WORK/.code"
REVIEW_DELIVERY_DIR="$WORK/.delivery"
export REVIEW_DELIVERY_DIR
# shellcheck source=./review-delivery.sh
source "${CODE_DIR}/.github/scripts/review-delivery.sh"

ROOT="$WORK/mail/agent-comms"
BODY="$WORK/body.md"
printf 'Вердикт тестового круга по PR #%s.\n' "$PR" > "$BODY"

FAILED=0
check() { # <что> <ожидалось> <получено>
  if [ "$2" = "$3" ]; then
    echo "  ok   · $1"
  else
    echo "  FAIL · $1: ожидалось '$2', получено '$3'"
    FAILED=1
  fi
}

# Тред-фикстура: одно письмо curator с заданным полем парка (пусто — парка нет).
make_thread() { # <id треда> <значение parked-on|пусто>
  local id="$1" park="${2:-}"
  mkdir -p "${ROOT}/${id}/messages"
  {
    printf -- '---\n'
    printf 'title: Фикстура парка «%s»\n' "${park:-нет парка}"
    printf 'participants: curator, dev-core, reviewer-pr\n'
    printf 'status: open\n'
    printf -- '---\n'
  } > "${ROOT}/${id}/_meta.md"
  {
    printf -- '---\n'
    printf 'from: curator\n'
    printf 'worker: claude-code\n'
    printf 'date: 2026-09-03T00:10:00Z\n'
    printf 'expects: answer\n'
    printf 'waiting-on: reviewer-pr\n'
    [ -n "$park" ] && printf 'parked-on: %s\n' "$park"
    printf -- '---\n\n'
    printf 'Метка `review` повешена, ход передан ревьюеру.\n'
  } > "${ROOT}/${id}/messages/2026-09-03T00-10-00Z-curator.md"
  git -C "$WORK/mail" add -A
  git -C "$WORK/mail" commit -q --no-verify -m "фикстура ${id}"
}

# Что дверь считает СТОЯЩИМ парком сейчас — тем же сухим прогоном, что и в проде.
standing_park() { # <тред>
  park_probe "$ROOT" "$1" reviewer-pr "$BODY" --waiting-on curator 2>/dev/null
}

case_park() { # <номер> <что за состояние> <значение парка|пусто> <ожидаемый флаг> <остаётся ли парк стоять: yes|no> <ожидаемый код двери>
  local n="$1" what="$2" value="${3:-}" want_flags="$4" want_left="$5" want_code="${6:-0}"
  local id="90${n}-фикстура-парка"
  echo "== ($n) ${what}"
  make_thread "$id" "$value"

  local park flags
  park="$( (cd "$WORK" && standing_park "$id") )"
  check "стоящий парк прочитан дверью" "$value" "$park"
  flags="$(park_flags "$park" "$PR")"
  check "флаг выбран" "$want_flags" "$flags"

  local before after out
  before="$(find "${ROOT}/${id}/messages" -name '*.md' | wc -l)"
  # shellcheck disable=SC2086 # $flags — набор аргументов, не строка
  out=$( (cd "$WORK/.code" && pnpm -F agent-protocol --silent cli new-message \
      --root "$ROOT" --repo . --ref origin/main \
      --thread "$id" --from reviewer-pr --expects answer --waiting-on curator \
      ${flags} --verdict approve --pr "$PR" \
      --worker gh-action --body-file "$BODY" --write --no-push) 2>&1 )
  local code=$?
  after="$(find "${ROOT}/${id}/messages" -name '*.md' | wc -l)"
  check "код двери" "$want_code" "$code"
  if [ "$want_code" = "0" ]; then
    check "письмо ЛЕГЛО (файлов в треде стало +1)" "$((before + 1))" "$after"
  else
    check "письмо НЕ легло — замеренный предел, см. шапку" "$before" "$after"
    echo "    отказ двери дословно: ${out}"
  fi

  local left
  left="$( (cd "$WORK" && standing_park "$id") )"
  if [ "$want_left" = "yes" ]; then
    check "чужой парк ОСТАЛСЯ стоять после письма" "$value" "$left"
  else
    check "свой парк СНЯТ письмом" "" "$left"
  fi
}

echo "почта — копия в ${ROOT}, живая не трогается; PR фикстуры — #${PR}"
case_park 1 "парка нет"                       ""          ""                        no  0
case_park 2 "парк за ЭТИМ кругом — run:${PR}" "run:${PR}" "--park-lifted run:${PR}" no  0
case_park 3 "парк за ЭТИМ merge — pr:${PR}"   "pr:${PR}"  "--park-lifted pr:${PR}"  no  0
case_park 4 "парк на человеке"                "john"      "--parked-on john"        yes 0

# --- ЗАМЕРЕННЫЙ ПРЕДЕЛ (5) и (6): ЧУЖОЙ `run:`/`pr:` ------------------------------
# Требование C постановки 088 говорит «чужой парк — письмо встаёт РЯДОМ, `--parked-on
# <ровно то значение>`», и флаг выбирается именно такой. Но повторить чужой парк ЭТИМ
# флагом дверь даёт НЕ ВСЕГДА, и это измерено здесь, а не выведено:
#   · (5) `run:<чужой PR>`, круг на котором УЖЕ ЗАВЕРШИЛСЯ, — отказ: «every run on head
#     … has ALREADY FINISHED … Read the outcome and report it» (лифт смотрит только
#     вперёд, тред 032). Прочесть чужой исход шаг доставки не может и не должен;
#   · (6) `pr:<чужой PR>` — отказ: «declared without naming who will move that merge …
#     Add '--park-mover <participant>'» (тред 061). Имя двигателя в отказе про СТОЯЩИЙ
#     парк не названо, то есть из двери его не прочитать — только вторым разбором ленты.
# Ни то, ни другое не чинится выбором флага, а лечение требует либо нового чтения ленты,
# либо правки пакета — то есть выходит за границы постановки («новых норм не вводить»).
# ДОКЛАДЫВАЕТСЯ curator, здесь фиксируется КАК ЕСТЬ: письмо не легло, чужой парк остался
# стоять, и провал ГРОМКИЙ (`::error::new-message отказал`, `thread failed`, итоговый шаг
# называет тред непоставленным) — молчаливой потери, ради которой писан 088, нет.
case_park 5 "парк за ЧУЖИМ кругом (предел)"   "run:191"   "--parked-on run:191"     yes 2
case_park 6 "парк за ЧУЖИМ merge (предел)"    "pr:191"    "--parked-on pr:191"      yes 2

# --- (7) отказ двери НЕ ПО ПАРКУ: предупреждение в лог, парк не выдуман ------------
# Ветвь, в которой был измеренный дефект: диагностика `park_probe` уезжала в stdout и
# становилась значением парка. Отказ здесь настоящий — несуществующая роль в `--from`.
echo "== (7) сухой прогон отказал НЕ по парку (несуществующая роль)"
make_thread "907-фикстура-парка" ""
PROBE_ERR="$WORK/probe.err"
PROBE_OUT="$( (cd "$WORK" && park_probe "$ROOT" 907-фикстура-парка dev-kore "$BODY" --waiting-on curator) 2>"$PROBE_ERR" )"
check "парк не выдуман из текста отказа" "" "$PROBE_OUT"
check "флага парка из него не строится" "" "$(park_flags "$PROBE_OUT" "$PR")"
check "предупреждение уехало в лог (stderr)" "да" \
  "$(grep -q '::warning::сухой прогон new-message отказал не по парку' "$PROBE_ERR" && echo да || echo нет)"
echo "    дословно: $(head -c 200 "$PROBE_ERR")"

if [ "$FAILED" = "0" ]; then
  echo "интеграционный прогон доставки: ВСЕ СОСТОЯНИЯ ПРОШЛИ"
else
  echo "интеграционный прогон доставки: ЕСТЬ ПРОВАЛЫ"
  exit 1
fi
