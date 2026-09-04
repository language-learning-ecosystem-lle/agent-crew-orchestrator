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
# НОМЕР СОСТОЯНИЯ ОБЪЯВЛЯЕТСЯ, А НЕ СЧИТАЕТСЯ ГЛАЗОМ (тред 094, сведение с тредом 118).
# Прогон растёт хвостом сразу у нескольких тредов, и два из них уже заняли одни и те же
# номера в один день: механическое склеивание дало бы файл с двумя разными состояниями
# под номером (10) и итоговой строкой, врущей про их число. Отсюда: каждое состояние
# отмечается здесь, повтор номера — ПРОВАЛ ПО ИМЕНИ, а итог называет число, которое
# посчитано прогоном, а не переписано из письма.
STATES=""
note_state() { # <номер состояния>
  case " $STATES " in
    *" $1 "*) echo "  FAIL · состояние ($1) объявлено дважды — номера разошлись"; FAILED=1 ;;
  esac
  STATES="$STATES $1"
}
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
  note_state "$n"
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
note_state 7
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
  note_state "$n"
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

# --- (10)–(13) ТЕКСТ ПИСЬМА ВЕТВИ «ВЕРДИКТА НЕТ» — САМИМ ШАГОМ ИЗ `.yml` -------------
#
# ЗАЧЕМ ЗДЕСЬ, А НЕ ЮНИТОМ (тред 118). Юнит закрывает чистый предикат
# `review_failure_cause`; ветвление и САМ ТЕКСТ письма остаются в `claude-review.yml`
# (выносить их в `.github/scripts/**` запрещено постановкой: вынос снял бы файл с гарда 4,
# то есть с кнопки john). Значит гонять их можно только ШАГОМ ЦЕЛИКОМ — иначе «письмо
# называет причину» проверялось бы живым кругом ревью ценой ~$2.4 и сожжённой квоты.
# Отсюда: тело шага ВЫНИМАЕТСЯ ИЗ YAML как есть (не переписывается сюда — переписанная
# копия разошлась бы с оригиналом молча) и исполняется на подложном транскрипте.
#
# ЧТО ПОДЛОЖНОЕ, А ЧТО НАСТОЯЩЕЕ. Настоящие: тело шага, `review-delivery.sh`, транскрипт
# формой из живого артефакта. Подложные: `gh` (отдаёт описание PR и ловит письмо
# `pr comment --body-file`) и `pnpm` (шаг спрашивает у пакета, есть ли роль). Описание PR
# НАМЕРЕННО без строки `thread:`: шаг доставляет коммент первым, а на отсутствии треда
# выходит — почта и сеть в этих состояниях не нужны вовсе, их путь закрыт (8)/(9).
# Сверяется ТЕКСТ ПИСЬМА, а не код выхода: код здесь `1` во всех состояниях (вердикта нет
# и тред не назван), и он о причине не говорит ничего.
STEP_SH="$WORK/step.sh"
python3 - "${CODE_DIR}/.github/workflows/claude-review.yml" "$STEP_SH" "$WORK/step.env" <<'PY'
import sys, yaml
NAME = "Итог доставок — что доехало и что нет"
wf = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
steps = [s for job in wf["jobs"].values() for s in job.get("steps", [])]
found = [s for s in steps if s.get("name") == NAME]
if len(found) != 1:
    sys.exit(f"шаг '{NAME}' найден {len(found)} раз(а) — вынуть тело нечем")
open(sys.argv[2], "w", encoding="utf-8").write(found[0]["run"])
env = found[0].get("env") or {}
open(sys.argv[3], "w", encoding="utf-8").write(str(env.get("EXECUTION_FILE", "")))
PY
[ -s "$STEP_SH" ] || { echo "  FAIL · тело шага не вынуто из yaml"; FAILED=1; }

# ПЕРЕМЕННАЯ ШАГА — ПРОВЕРЯЕТСЯ ОТДЕЛЬНО, И ЭТО НЕ ПЕДАНТИЗМ (тот же класс, что дефект
# `MAIL_REMOTE` в шапке (8)/(9)): состояния ниже подают `EXECUTION_FILE` сами, поэтому
# забытая строка в `env:` шага прошла бы мимо них зелёной, а в проде причина никогда бы
# не называлась — письмо молчало бы о ней ровно так же, как до починки.
echo "== (10-13) причина «вердикта нет» называется письмом"
check "шаг получает транскрипт из выхода действия" \
  '${{ steps.reviewer.outputs.execution_file }}' "$(cat "$WORK/step.env")"

# Транскрипт формой из живого артефакта `reviewer-execution-239-33762234440`.
LIMIT_RESULT="You've hit your session limit · resets 1:40pm (UTC)"
exec_fixture() { # <имя> <json последней записи>
  local path="$WORK/exec-$1.json"
  printf '[{"type":"system","subtype":"init"},%s]\n' "$2" > "$path"
  printf '%s' "$path"
}
F_LIMIT="$(exec_fixture limit "$(printf '{"type":"result","subtype":"success","is_error":true,"api_error_status":429,"terminal_reason":"api_error","result":"%s"}' "$LIMIT_RESULT")")"
F_TURNS="$(exec_fixture turns '{"type":"result","is_error":true,"api_error_status":null,"terminal_reason":"max_turns","result":"Reached maximum turns"}')"

letter_case() { # <номер> <что за состояние> <файл транскрипта|пусто> <самопропуск: 0|1>
  local n="$1" what="$2" exec_file="${3:-}" self_skip="${4:-0}"
  note_state "$n"
  echo "== ($n) ${what}"
  local arena="$WORK/letter-$n" bin
  bin="$arena/bin"
  mkdir -p "$arena/.delivery" "$bin"
  ln -s "$CODE_DIR" "$arena/.code"

  # `gh`: описание PR (с `role:`, без `thread:`), голова и ЛОВУШКА ПИСЬМА.
  cat > "$bin/gh" <<STUB
#!/usr/bin/env bash
case "\$*" in
  *"--json body"*)       printf 'Описание PR фикстуры.\n\nrole: dev-core\n' ;;
  *"--json headRefOid"*) printf '97e22acb804480d921e1b9cdf52bf045aadc4b56\n' ;;
  *"pr comment"*)        cp "\${!#}" "$arena/letter.md" ;;
  *)                     echo "gh-фикстура: неожиданный вызов: \$*" >&2; exit 3 ;;
esac
STUB
  # `pnpm`: у шага к пакету один вопрос — есть ли роль в конфиге. Есть.
  printf '#!/usr/bin/env bash\nexit 0\n' > "$bin/pnpm"
  chmod +x "$bin/gh" "$bin/pnpm"

  (
    cd "$arena" || exit 3
    PATH="$bin:$PATH" \
    GITHUB_WORKSPACE="$arena" GH_TOKEN="$FAKE_TOKEN" \
    PR="$PR" RUN_ID=33762234440 RUN_URL="https://example.invalid/runs/33762234440" \
    SELF_SKIP="$self_skip" EXECUTION_FILE="$exec_file" \
      bash "$STEP_SH"
  ) > "$arena/step.log" 2>&1
  if [ ! -s "$arena/letter.md" ]; then
    echo "  FAIL · письмо не составлено вовсе"; FAILED=1; sed 's/^/    /' "$arena/step.log"; return 0
  fi
  LETTER="$(cat "$arena/letter.md")"
}

has() { # <что искать>
  case "$LETTER" in *"$1"*) printf 'да' ;; *) printf 'нет' ;; esac
}

letter_case 10 "429: письмо называет лимит и запрещает ранний перезапуск" "$F_LIMIT" 0
check "названа причина — лимит аккаунта" "да" "$(has 'ЛИМИТ АККАУНТА')"
check "названы машинные поля, а не проза" "да" "$(has 'api_error_status: 429')"
check "сказано, что ранний перезапуск сожжёт круг" "да" \
  "$(has 'Перезапуск ДО ресета сожжёт второй круг впустую')"
check "строка result процитирована ДОСЛОВНО" "да" "$(has "$LIMIT_RESULT")"
check "общий совет остался — но ПОСЛЕ ресета" "да" "$(has 'ПОСЛЕ ресета — Ревью перезапускается вручную')"
check "и это по-прежнему письмо об отсутствии вердикта" "да" \
  "$(has 'Ревью не состоялось: вердикт не сформирован.')"

letter_case 11 "иная причина: названа полем, лекарство остаётся общим" "$F_TURNS" 0
check "причина названа полем как есть" "да" "$(has 'транскрипта прогона: `max_turns`')"
check "лимит НЕ приписан" "нет" "$(has 'ЛИМИТ АККАУНТА')"
check "общий совет на месте и без условия про ресет" "да" \
  "$(has 'Ревью перезапускается вручную — коммент `@claude` в PR либо снять и повесить метку `review` заново.')"
check "и не «после ресета»" "нет" "$(has 'ПОСЛЕ ресета')"

letter_case 12 "транскрипта нет: СЕГОДНЯШНИЙ текст без изменений" "" 0
check "причина не выдумана" "нет" "$(has 'машинным полем')"
check "лимит не выдуман" "нет" "$(has 'ЛИМИТ АККАУНТА')"
check "печатается ровно общий совет" "да" \
  "$(has 'Ревью перезапускается вручную — коммент `@claude` в PR либо снять и повесить метку `review` заново.')"
# «Без изменений» проверяется концом письма: сегодняшняя ветвь кончалась ровно этой
# строкой, и ничего после неё не появилось.
check "и он ПОСЛЕДНЯЯ строка письма — приписок нет" "да" \
  "$(case "$LETTER" in *'потом решается, платить ли за вторую попытку.') printf 'да' ;; *) printf 'нет' ;; esac)"

# ГРАНИЦА: самопропуск стои́т ПЕРВЫМ в цепочке и не трогается (требование 6 постановки) —
# даже когда транскрипт 429 лежит рядом. Состояние не гипотетическое: ветка с правкой
# воркфлоу и есть тот случай, когда обе половины могут сойтись.
letter_case 13 "самопропуск + транскрипт 429: самопропуск первым" "$F_LIMIT" 1
check "напечатан самопропуск" "да" "$(has 'пропустил сам себя')"
check "лимит не подмешан" "нет" "$(has 'ЛИМИТ АККАУНТА')"

# --- (14)/(15) ОТКАЗ ДОСТАВКИ АДРЕСУЕТСЯ АВТОРУ PR (решение john, тред 094) ---------
#
# ЭТО ПРИЁМКА ПОСТАНОВКИ 094 на тех самых состояниях (5) и (6): дверь по решению john не
# трогается, чужой `run:`/`pr:`-парк письмо в тред PR по-прежнему не пускает — но отказ
# ТЕПЕРЬ АДРЕСНЫЙ. Проверяется не текст в логе, а ФАКТ: письмо об отказе лежит в приёмнике
# в УДАЛЁННОЙ почте, ход в нём — на АВТОРЕ PR, и оно называет три вещи (тред, чужой парк с
# номером, место, где висит вердикт). Тред PR при этом остаётся стоять за чужим парком и
# письма не получает: лечится адресация, а не дверь.
# Номера тредов — ТРЁХЗНАЧНЫЕ и передаются явно: дверь читает только `^\d{3}-` («thread
# id … is not a thread the mail can read»), и `9${n}0` при двузначном номере состояния
# давало бы четыре цифры. Поймано этим же прогоном.
escalation_case() { # <номер состояния> <значение ЧУЖОГО парка> <id треда PR> <id приёмника>
  local n="$1" value="$2"
  note_state "$n"
  echo "== ($n) чужой парк '${value}': письмо в тред PR не легло — отказ адресован автору"
  local arena="$WORK/e2e-$n" ws
  ws="$arena/ws"
  mkdir -p "$arena/mail/agent-comms" "$ws"
  git -C "$arena/mail" init -q -b comms
  git -C "$arena/mail" config user.name "integration"
  git -C "$arena/mail" config user.email "integration@agents.invalid"
  git -C "$arena/mail" config receive.denyCurrentBranch updateInstead
  git -C "$ws" init -q -b work
  git -C "$ws" config user.name "integration"
  git -C "$ws" config user.email "integration@agents.invalid"
  git -C "$ws" commit -q --allow-empty -m "рабочее дерево джобы"
  git -C "$ws" remote add origin "https://example.invalid/mail.git"
  ln -s "$CODE_DIR" "$ws/.code"

  MAIL_DIR="$arena/mail"
  ROOT="$MAIL_DIR/agent-comms"
  local id="$3" recv="$4"
  make_thread "$id" "$value"
  # Приёмник — СТОЯЧИЙ АДРЕС, и с тредом 125 он адресуется слагом: `deliver_to_thread`
  # зовёт дверь с `--ensure-thread`, а та выбирает старший открытый непаркованный
  # приёмник этого слага. Парка на приёмнике нет (стоячий адрес не паркуют), и слаг
  # фикстуры ЛАТИНСКИЙ: `unreadableReceiverSlug` отказывает всему прочему по имени.
  make_thread "$recv" ""

  local before after code
  before="$(git -C "$MAIL_DIR" ls-tree -r --name-only comms -- "agent-comms/${id}/messages" | wc -l)"
  (
    cd "$ws" || exit 3
    export GITHUB_WORKSPACE="$ws"
    export GITHUB_SERVER_URL="https://example.invalid"
    export GITHUB_REPOSITORY="owner/repo"
    export MAIL_REMOTE="$MAIL_DIR"
    export REVIEW_DELIVERY_DIR="$arena/.delivery"
    # Приёмник и автор названы снаружи: сети у харнесса нет, а `gh pr view` — сеть.
    # Ветвь «прочитать автора из описания PR» закрыта юнитом (`pr_body_role`).
    export REVIEW_ESCALATION_ADDRESS="${recv#[0-9][0-9][0-9]-}"
    export REVIEW_PR_AUTHOR="dev-core"
    # shellcheck source=./comms-push.sh
    source "${CODE_DIR}/.github/scripts/comms-push.sh"
    # shellcheck source=./review-delivery.sh
    source "${CODE_DIR}/.github/scripts/review-delivery.sh"
    # Коммент в PR уехал — значит письмо об отказе обязано сказать, что текст там.
    delivery_mark comment ok
    deliver_to_thread "$id" reviewer-pr "$BODY" "вердикт ревьюера по #${PR}" "$PR" \
      --waiting-on curator --verdict approve --pr "$PR"
  ) > "$arena/out.log" 2>&1
  code=$?

  check "deliver_to_thread отказала (дверь не смягчена)" "1" "$code"
  after="$(git -C "$MAIL_DIR" ls-tree -r --name-only comms -- "agent-comms/${id}/messages" | wc -l)"
  check "письмо в тред PR НЕ легло — предел остался пределом" "$before" "$after"

  local esc
  esc="$(git -C "$MAIL_DIR" -c core.quotePath=false ls-tree -r --name-only comms \
      -- "agent-comms/${recv}/messages" | grep -- '-reviewer-pr\.md$' | head -n1)"
  check "письмо об отказе ЛЕГЛО В УДАЛЁННОЙ почте приёмника" "да" \
    "$([ -n "$esc" ] && echo да || echo нет)"
  [ -n "$esc" ] || { sed 's/^/    /' "$arena/out.log"; return 0; }

  local text
  text="$(git -C "$MAIL_DIR" -c core.quotePath=false show "comms:${esc}")"
  check "ход в письме — на АВТОРЕ PR, а не на роли, поднятой смотрителем" "да" \
    "$(printf '%s' "$text" | grep -qE '^waiting-on: dev-core$' && echo да || echo нет)"
  check "назван тред, не принявший вердикт" "да" \
    "$(printf '%s' "$text" | grep -q "$id" && echo да || echo нет)"
  check "назван ЧУЖОЙ парк с номером" "да" \
    "$(printf '%s' "$text" | grep -qF "$value" && echo да || echo нет)"
  check "названо место, где висит вердикт" "да" \
    "$(printf '%s' "$text" | grep -q "висит комментом в самом PR #${PR}" && echo да || echo нет)"

  # ПИСЬМО ОДНО НА КРУГ: шагов доставки два, и второй зовёт ту же дорогу — автор не должен
  # получить два письма об одном событии в стоячий адрес.
  (
    cd "$ws" || exit 3
    export GITHUB_WORKSPACE="$ws" MAIL_REMOTE="$MAIL_DIR" REVIEW_DELIVERY_DIR="$arena/.delivery"
    export GITHUB_SERVER_URL="https://example.invalid" GITHUB_REPOSITORY="owner/repo"
    export REVIEW_ESCALATION_ADDRESS="${recv#[0-9][0-9][0-9]-}" REVIEW_PR_AUTHOR="dev-core"
    # shellcheck source=./comms-push.sh
    source "${CODE_DIR}/.github/scripts/comms-push.sh"
    # shellcheck source=./review-delivery.sh
    source "${CODE_DIR}/.github/scripts/review-delivery.sh"
    deliver_to_thread "$id" reviewer-pr "$BODY" "вердикт ревьюера по #${PR}" "$PR" \
      --waiting-on curator --verdict approve --pr "$PR"
  ) >> "$arena/out.log" 2>&1
  check "второй шаг доставки второго письма в приёмник НЕ добавил" "1" \
    "$(git -C "$MAIL_DIR" -c core.quotePath=false ls-tree -r --name-only comms \
       -- "agent-comms/${recv}/messages" | grep -c -- '-reviewer-pr\.md$')"

  local left
  left="$( (cd "$ws" && standing_park "$id") )"
  check "чужой парк на треде PR ОСТАЛСЯ стоять" "$value" "$left"
}

# Слаг приёмника у состояний РАЗНЫЙ: у каждого своя почта, но один слаг на двоих
# читался бы как «один адрес, два приёмника» — состояние, о котором эти состояния не
# говорят ничего.
escalation_case 14 "run:191" 910-фикстура-парка 911-stand-in-receiver
escalation_case 15 "pr:191"  912-фикстура-парка 913-second-receiver

if [ "$FAILED" = "0" ]; then
  echo "интеграционный прогон доставки: ВСЕ СОСТОЯНИЯ ПРОШЛИ — $(printf '%s' "$STATES" | wc -w) шт."
else
  echo "интеграционный прогон доставки: ЕСТЬ ПРОВАЛЫ"
  exit 1
fi
