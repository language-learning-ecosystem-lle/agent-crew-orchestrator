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

# Каталог почты — ПЕРЕМЕННОЙ, а не литералом: состояния (8)/(9) гоняют весь путь
# доставки и каждому нужна СВОЯ почта (см. их шапку — пуш в общую отказала бы
# удалённая сторона из-за грязного дерева, оставленного состояниями (1)–(7)).
MAIL_DIR="$WORK/mail"
ROOT="$MAIL_DIR/agent-comms"
BODY="$WORK/body.md"
# Заведомо НЕ секрет: сеть не трогается, а url с этой подстрокой переписывается
# `insteadOf` на путь во временном каталоге (состояния (8)/(9)).
FAKE_TOKEN="integration-not-a-secret"
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
  git -C "$MAIL_DIR" add -A
  git -C "$MAIL_DIR" commit -q --no-verify -m "фикстура ${id}"
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

# --- (8)/(9) ВЕСЬ ПУТЬ ДОСТАВКИ ЦЕЛИКОМ — `deliver_to_thread`, а не дверь напрямую ---
#
# ЗАЧЕМ, И ЭТО ОТВЕТ НА СОБСТВЕННЫЙ ПРОМАХ ЭТОГО ФАЙЛА. Состояния (1)–(7) гоняют
# `park_probe` + `park_flags` + `new-message` — то есть РЕШЕНИЕ о парке, минуя
# `deliver_to_thread`. Цена промаха измерена: переезд доставки из yaml в скрипт потерял
# присваивание `MAIL_REMOTE`, первой строкой `review_mail_checkout` стои́т
# `${MAIL_REMOTE:?…}`, и неинтерактивный bash на такой подстановке выходит НЕМЕДЛЕННО —
# письмо в тред не ушло бы НИ НА ОДНОЙ из двух ветвей, а шесть зелёных состояний об этом
# не сказали ничего (тред 088, доклад dev-core 2026-09-03). Юнит закрыл сборку url; здесь
# закрывается то, чего юнит не видит, — что функция ДОХОДИТ ДО ДВЕРИ и письмо уезжает.
#
# ЧТО ГОНЯЕТСЯ: `deliver_to_thread` целиком, как её зовёт джоба, — `review_mail_checkout`
# (fetch почты + свой worktree `.comms-fallback` + креденшл), сухая проба парка поверх
# свежей головы, запись, коммит и НАСТОЯЩИЙ `comms_push` в удалённую почту. Проверяется
# не «легло в рабочем дереве», а «легло В ВЕТКЕ `comms` УДАЛЁННОЙ почты», то есть пуш
# прошёл: локальная запись без пуша — ровно та потеря, ради которой писан 088.
#
# ПОЧВА. Сеть не нужна и не трогается: удалённая почта — путь на диске, `origin` рабочего
# дерева канонизируется в несуществующий `example.invalid` (в него не ходят, только
# `set-url` — тред 016). У каждого состояния СВОЯ пара «почта + рабочее дерево»: почта
# состояний (1)–(7) осталась с незакоммиченными письмами, а пуш в репозиторий с выкаченной
# веткой требует чистого дерева (`receive.denyCurrentBranch=updateInstead`).
delivery_case() { # <номер> <что за состояние> <значение парка|пусто> <остаётся ли парк: yes|no> <откуда remote: token|named>
  local n="$1" what="$2" value="${3:-}" want_left="$4" remote_mode="${5:-token}"
  echo "== ($n) ${what}"
  local arena="$WORK/e2e-$n" ws
  ws="$arena/ws"
  mkdir -p "$arena/mail/agent-comms" "$ws"
  git -C "$arena/mail" init -q -b comms
  git -C "$arena/mail" config user.name "integration"
  git -C "$arena/mail" config user.email "integration@agents.invalid"
  # Пуш идёт в НЕ голый репозиторий с выкаченной `comms`: `updateInstead` двигает и
  # ветку, и рабочее дерево — иначе удалённая сторона отказала бы пуш, и «легло ли»
  # пришлось бы мерить мимо того, что читает дверь.
  git -C "$arena/mail" config receive.denyCurrentBranch updateInstead
  git -C "$ws" init -q -b work
  git -C "$ws" config user.name "integration"
  git -C "$ws" config user.email "integration@agents.invalid"
  git -C "$ws" commit -q --allow-empty -m "рабочее дерево джобы"
  git -C "$ws" remote add origin "https://example.invalid/mail.git"
  ln -s "$CODE_DIR" "$ws/.code"

  # РЕЖИМ `token` ГОНЯЕТ РОВНО ПРОДОВЫЙ ПУТЬ: `MAIL_REMOTE` НЕ ЗАДАН, и функция обязана
  # собрать url сама из `GH_TOKEN`/`GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`. Именно этот
  # случай и был дефектом переезда, и харнесс, подающий `MAIL_REMOTE` снаружи, его бы
  # не поймал — проверено мутацией (вернуть присваивание в `${MAIL_REMOTE:?}` и увидеть
  # красное). Собранный url — всегда `https://`, поэтому на диск он попадает
  # `insteadOf`: сети по-прежнему нет, а строку собирает КОД, а не тест.
  local built_url="https://x-access-token:${FAKE_TOKEN}@example.invalid/owner/repo"
  git -C "$ws" config "url.${arena}/mail.insteadOf" "$built_url"

  MAIL_DIR="$arena/mail"
  ROOT="$MAIL_DIR/agent-comms"
  local id="90${n}-фикстура-парка"
  make_thread "$id" "$value"

  local before after code
  before="$(git -C "$MAIL_DIR" ls-tree -r --name-only comms -- "agent-comms/${id}/messages" | wc -l)"
  (
    cd "$ws" || exit 3
    export GITHUB_WORKSPACE="$ws"
    export GITHUB_SERVER_URL="https://example.invalid"
    export GITHUB_REPOSITORY="owner/repo"
    export GH_TOKEN="$FAKE_TOKEN"
    # `named` — вторая ветвь той же функции: названный снаружи url не подменяется.
    [ "$remote_mode" = "named" ] && export MAIL_REMOTE="$MAIL_DIR"
    # Тот же порядок source, что у шага джобы: `comms_push` и потолок попыток — оттуда.
    # shellcheck source=./comms-push.sh
    source "${CODE_DIR}/.github/scripts/comms-push.sh"
    # shellcheck source=./review-delivery.sh
    source "${CODE_DIR}/.github/scripts/review-delivery.sh"
    deliver_to_thread "$id" reviewer-pr "$BODY" "вердикт ревьюера по #${PR}" "$PR" \
      --waiting-on curator --verdict approve --pr "$PR"
  ) > "$arena/out.log" 2>&1
  code=$?

  check "deliver_to_thread дошла до конца" "0" "$code"
  [ "$code" = "0" ] || sed 's/^/    /' "$arena/out.log"
  after="$(git -C "$MAIL_DIR" ls-tree -r --name-only comms -- "agent-comms/${id}/messages" | wc -l)"
  check "письмо ЛЕГЛО В УДАЛЁННОЙ почте (то есть push прошёл)" "$((before + 1))" "$after"
  # `core.quotePath=false` — имена тредов кириллические, и git по умолчанию отдаёт их
  # экранированными восьмеричными кодами в кавычках: подпись из такого пути не вырезать.
  check "письмо подписано шагом, а не агентом" "reviewer-pr" \
    "$(git -C "$MAIL_DIR" -c core.quotePath=false ls-tree -r --name-only comms \
       -- "agent-comms/${id}/messages" \
       | grep -v -- '-curator\.md$' | head -n1 | sed 's|.*/[^/]*Z-||; s|\.md$||')"

  local left
  left="$( (cd "$ws" && standing_park "$id") )"
  if [ "$want_left" = "yes" ]; then
    check "чужой парк ОСТАЛСЯ стоять после доставки" "$value" "$left"
  else
    check "свой парк СНЯТ доставкой" "" "$left"
  fi
}

delivery_case 8 "весь путь, url собран из токена: парк за ЭТИМ кругом — run:${PR}" "run:${PR}" no  token
delivery_case 9 "весь путь, url назван снаружи: парк на человеке"                  "john"      yes named

if [ "$FAILED" = "0" ]; then
  echo "интеграционный прогон доставки: ВСЕ СОСТОЯНИЯ ПРОШЛИ"
else
  echo "интеграционный прогон доставки: ЕСТЬ ПРОВАЛЫ"
  exit 1
fi
