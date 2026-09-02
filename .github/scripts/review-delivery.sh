# shellcheck shell=bash
#
# ДОСТАВКА ВЕРДИКТА РЕВЬЮЕРА — ШАГАМИ ДЖОБЫ (тред 088, постановка curator 2026-09-02).
#
# ЧТО ИЗМЕРЕНО И ПОЧЕМУ ЭТО ОДНА БОЛЕЗНЬ, А НЕ ТРИ. Круг по PR #204 (прогон
# 33661622377, голова 181157ad, 2026-09-02T17:33Z): действие упало за 76 с
# (`is_error:true`), `verdict.md` не создан, а шаг-страховка доставил коммент в PR и
# ОТКАЗАЛ на письме в тред — дословно «thread '067-park-lift-narrowing' is PARKED
# behind the round running on PR #204 … and this message says nothing about it».
# Дверь почты сработала верно; отказал звонящий. И тред был запаркован НЕ случайно:
# маршрут карточки curator — «повесил метку → передал ход → запарковался на run:<N>»,
# то есть в правильно исполненном случае ветвь «вердикта нет» доезжает ровно до
# запаркованного треда и не доезжает никогда.
# Ещё два случая того же класса измерены в соседнем контуре за тот же час: (а) агент
# написал вердикт и умер ДО отправки — текст не прочитал никто; (б) вердикт уехал
# письмом и комментом, а формальный статус упал, и страховка напечатала «не сработала
# ни одна из трёх доставок» прямо под самим вердиктом.
# Общий диагноз john (тред 082) в двух словах: ДОСТАВКА ВИСИТ НА АГЕНТЕ, А СУЖДЕНИЕ О
# НЕЙ ВЫНОСИТСЯ ПО НАЛИЧИЮ ФАЙЛА НА ДИСКЕ.
#
# ОТСЮДА ТРИ ВЕЩИ, КОТОРЫЕ ДЕЛАЕТ ЭТОТ ФАЙЛ:
#   1. обязанность агента сокращена до записи `verdict.md`; письмо в тред и коммент в
#      PR делают шаги джобы, и смерть агента ПОСЛЕ записи файла больше не съедает
#      результат круга;
#   2. каждая из трёх доставок (тред, коммент, формальный статус) УЧИТЫВАЕТСЯ ПОИМЕННО
#      (`delivery_mark`/`delivery_summary`), и «не сработала ни одна» печатается,
#      только если это правда;
#   3. любая доставка в тред ПЕРЕЖИВАЕТ ЛЮБОЙ СТОЯЩИЙ ПАРК: стоящий парк ЧИТАЕТСЯ
#      (`park_probe`) и по нему выбирается флаг (`park_flags`) — снять свой, встать
#      рядом с чужим.
#
# ЛОГИКА ЖИВЁТ ЗДЕСЬ, А НЕ В YAML, по той же причине, что и `comms-push.sh`: правило,
# спрятанное в шаге воркфлоу, не гоняется ничем, кроме живого круга ревью ценой ~$2.4.
# Чистые функции ниже покрыты `review-delivery.test.sh`, который поднимает сьюта
# (`src/roles/review-delivery.process.test.ts`).
#
# ИСПОЛЬЗОВАНИЕ:
#   source "${GITHUB_WORKSPACE}/.code/.github/scripts/review-delivery.sh"

# КАТАЛОГ УЧЁТА ДОСТАВОК — общий на все шаги джобы. Шаги делят рабочую директорию, но
# не переменные, поэтому исход каждой доставки кладётся файлом: итоговый шаг читает
# ФАКТ доставки, а не пересказывает догадку о ней.
REVIEW_DELIVERY_DIR="${REVIEW_DELIVERY_DIR:-${GITHUB_WORKSPACE:-.}/.delivery}"

# Записать исход доставки. <имя> — `thread`|`comment`|`status`; <исход> — `ok`|`failed`.
delivery_mark() { # <имя> <исход>
  local name="${1:?delivery_mark: не названа доставка}" state="${2:?delivery_mark: не назван исход}"
  mkdir -p "$REVIEW_DELIVERY_DIR"
  printf '%s\n' "$state" > "${REVIEW_DELIVERY_DIR}/${name}"
}

# Прочитать исход доставки. Файла нет — доставки НЕ БЫЛО (`none`), и это третье
# состояние, а не синоним отказа: шаг мог не дойти до неё вовсе.
delivery_state() { # <имя>
  local name="${1:?delivery_state: не названа доставка}"
  if [ -f "${REVIEW_DELIVERY_DIR}/${name}" ]; then
    tr -d '\r\n' < "${REVIEW_DELIVERY_DIR}/${name}"
  else
    printf 'none'
  fi
}

# ПОЛЕ ИЗ ШАПКИ `verdict.md` — `verdict`, `pr`, `waiting-on`. Читается только шапка
# (первые пять строк): дальше идёт текст вердикта, и слово `pr:` в теле не должно
# подменять якорь. Пустая строка в ответе значит «поля нет», а не «поле пустое».
verdict_field() { # <файл> <поле>
  local file="${1:?verdict_field: не назван файл}" field="${2:?verdict_field: не названо поле}"
  [ -f "$file" ] || return 0
  head -n 5 "$file" | tr -d '\r' \
    | grep -iE "^${field}:[[:space:]]*" | head -1 \
    | sed -E "s/^[^:]*:[[:space:]]*//; s/[[:space:]]+$//"
}

# СТОЯЩИЙ ПАРК ИЗ ОТКАЗА ДВЕРИ. Отказ `judgeParkSeen` называет парк дословно и вместе
# с лекарством — «'--parked-on run:204' if the question still stands». Значение парка
# берётся оттуда, а не вычисляется вторым разбором ленты: второй разбор был бы вторым
# мнением о парке, и разошёлся бы он ровно в тот день, когда это дороже всего.
park_value_of() { # <текст отказа двери>
  printf '%s' "${1:-}" | grep -oE "'--parked-on [^']+'" | head -1 \
    | sed -E "s/^'--parked-on //; s/'$//"
}

# ЧТО ЭТО ПИСЬМО ГОВОРИТ О СТОЯЩЕМ ПАРКЕ (требование C постановки 088). Правило одно
# и общее для обеих ветвей — и «вердикт есть», и «вердикта нет»:
#   · парк стои́т за ЭТИМ САМЫМ кругом (`run:<этот PR>` либо `pr:<этот PR>`) — письмо
#     его СНИМАЕТ и называет: круг завершён, пусть и без продукта, и это правда;
#   · парк стои́т за чем-то другим (человек, другой прогон, другой PR) — письмо встаёт
#     РЯДОМ (`--parked-on <ровно то значение, что стои́т>`): чужой парк снимать нечем,
#     и врать о нём нельзя;
#   · парка нет — без флагов.
# Слепое `--park-lifted run:<PR>` чинило бы ровно один случай из четырёх: названный не
# про тот парк, что стои́т, — ОТКАЗ записи (park-seen.ts:149), то есть письмо теряется
# так же, как теряется сегодня.
park_flags() { # <значение стоящего парка (пусто — парка нет)> <номер PR>
  local value="${1:-}" pr="${2:?park_flags: не назван номер PR}"
  [ -n "$value" ] || return 0
  if [ "$value" = "run:${pr}" ] || [ "$value" = "pr:${pr}" ]; then
    printf -- '--park-lifted %s' "$value"
  else
    printf -- '--parked-on %s' "$value"
  fi
}

# АДРЕСАТ ХОДА: объявлен агентом или выведен правилом (требование A постановки 088).
# Суждение агента не выбрасывается — оно объявляется строкой `waiting-on:` в шапке
# `verdict.md`; но доставка на нём не висит. Строки нет либо роли нет в конфиге —
# берётся детерминированное правило (approve → curator, needs-fixes → автор PR), и
# письмо ГОВОРИТ, что адресат выведен, а не объявлен.
# Печатает две колонки: `<роль|-> <declared|derived|none>`.
review_waiting_on() { # <объявленная роль|пусто> <объявленная существует: 1|0> <вердикт> <роль автора PR|пусто> <роль автора существует: 1|0>
  local declared="${1:-}" declared_ok="${2:-0}" verdict="${3:-}" author="${4:-}" author_ok="${5:-0}"
  if [ -n "$declared" ] && [ "$declared_ok" = "1" ]; then
    printf '%s declared' "$declared"
    return 0
  fi
  case "$verdict" in
    approve) printf 'curator derived' ;;
    needs-fixes)
      if [ -n "$author" ] && [ "$author_ok" = "1" ]; then
        printf '%s derived' "$author"
      else
        printf -- '- none'
      fi
      ;;
    *) printf -- '- none' ;;
  esac
}

# ЧТО ИМЕННО НЕ ДОЕХАЛО — одной строкой, по ФАКТУ доставки. Формулировка «не сработала
# ни одна из трёх доставок» печатается, только если это правда: под живым вердиктом,
# уехавшим письмом и комментом, она была ложью (случай (б), тред 082).
delivery_summary() { # <исход треда> <исход коммента> <исход статуса>
  local thread="${1:-none}" comment="${2:-none}" status="${3:-none}"
  local delivered="" missing="" name state
  for pair in "письмо в тред:${thread}" "коммент в PR:${comment}" "формальный review-статус:${status}"; do
    name="${pair%:*}"
    state="${pair##*:}"
    if [ "$state" = "ok" ]; then
      delivered="${delivered:+${delivered}, }${name}"
    else
      missing="${missing:+${missing}, }${name}"
    fi
  done
  if [ -z "$missing" ]; then
    printf 'все три доставки прошли: %s.' "$delivered"
  elif [ -z "$delivered" ]; then
    printf 'не сработала ни одна из трёх доставок: %s.' "$missing"
  else
    printf 'доставлено: %s. НЕ доставлено: %s.' "$delivered" "$missing"
  fi
}

# ЧЕКАУТ ПОЧТЫ У ЭТИХ ШАГОВ — СВОЙ, и креденшл ему передаётся ЯВНО. Прежде шаг
# переиспользовал `.comms-mail`, а создаёт его САМ АГЕНТ изнутри действия: чей он
# worktree и какой конфиг делит — решает чужой прогон, а не мы (`could not read
# Username`, exit 128, прогон 30500443878, тред 023). Отсюда свой `.comms-fallback` и
# сеть по URL с `GITHUB_TOKEN`, переданным АРГУМЕНТОМ, — в конфиг он не садится:
# осевший креденшл (его вписало и отозвало действие) и был исходной болезнью.
review_mail_checkout() { # требует MAIL_REMOTE
  : "${MAIL_REMOTE:?review_mail_checkout: не назван MAIL_REMOTE}"
  [ -d .comms-fallback ] && return 0
  # Канонический url — ДО первой сетевой команды git (тред 016, п.1): действие вписало
  # в `remote.origin.url` свой app-токен и отозвало его перед нашими шагами, и без
  # этого падал уже fetch почты.
  git remote set-url origin "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}"
  git fetch --no-tags "$MAIL_REMOTE" comms
  git worktree add .comms-fallback FETCH_HEAD
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
}

# СТОЯЩИЙ ПАРК ЧИТАЕТСЯ, А НЕ УГАДЫВАЕТСЯ — сухим прогоном той же самой команды.
# Дверь парка судит ДО того, как посмотрит на `--write` («a dry run is the preview of
# the write, and a preview that succeeds where the write refuses is a lie», cli.ts),
# поэтому сухой прогон без флагов парка — это ровно тот вопрос, который нам нужен:
# «что скажет дверь этому письму». Отказ несёт живое состояние парка, из него оно и
# берётся (`park_value_of`). Прогон идёт ПЕРЕД КАЖДОЙ попыткой записи, поверх только
# что подтянутой головы почты: в тред пишут двое, и парк может уехать между чтением и
# записью.
park_probe() { # <корень почты> <тред> <от кого> <файл тела> [прочие аргументы new-message...]
  local root="${1:?}" thread="${2:?}" from="${3:?}" body="${4:?}"
  shift 4
  local out
  if out=$( (cd .code && pnpm -F agent-protocol --silent cli new-message \
        --root "$root" --repo . --ref origin/main \
        --thread "$thread" --from "$from" --expects answer "$@" \
        --worker gh-action --body-file "$body" --no-push) 2>&1 ); then
    return 0
  fi
  local value
  value="$(park_value_of "$out")"
  if [ -z "$value" ]; then
    # Сухой прогон отказал НЕ ПО ПАРКУ — печатаем дословно: настоящая запись сейчас
    # отвалится тем же отказом, и он должен быть в логе один раз до, а не только
    # после.
    echo "::warning::сухой прогон new-message отказал не по парку — запись, скорее всего, отвалится тем же: ${out}"
    return 0
  fi
  printf '%s' "$value"
}

# ПИСЬМО В ТРЕД — одна дверь на обе ветви (вердикт есть / вердикта нет). Возвращает 0,
# если письмо ЛЕГЛО и уехало; 1 — если нет, и причина напечатана.
deliver_to_thread() { # <тред> <от кого> <файл тела> <сообщение коммита> <номер PR> [прочие аргументы new-message...]
  local thread="${1:?}" from="${2:?}" body="${3:?}" commit_msg="${4:?}" pr="${5:?}"
  shift 5
  local root="${GITHUB_WORKSPACE}/.comms-fallback/agent-comms"
  review_mail_checkout
  if [ ! -d "${root}/${thread}/messages" ]; then
    echo "::warning::Каталога .comms-fallback/agent-comms/${thread}/messages нет — в тред не сообщено."
    return 1
  fi
  COMMS_PUSH_DIR=.comms-fallback
  COMMS_PUSH_REMOTE="$MAIL_REMOTE"
  local attempt park park_args
  for attempt in $(seq 1 "$COMMS_PUSH_ATTEMPTS"); do
    git -C .comms-fallback fetch --no-tags "$MAIL_REMOTE" comms
    git -C .comms-fallback reset --hard FETCH_HEAD
    park="$(park_probe "$root" "$thread" "$from" "$body" "$@")"
    # shellcheck disable=SC2046 # аргументы флага парка разделяются по словам намеренно
    park_args=$(park_flags "$park" "$pr")
    [ -n "$park" ] && echo "На треде ${thread} стои́т парк '${park}' — письмо идёт с '${park_args}'."
    # shellcheck disable=SC2086 # $park_args и $@ — набор аргументов, не строка
    if ! (cd .code && pnpm -F agent-protocol --silent cli new-message \
          --root "$root" --repo . --ref origin/main \
          --thread "$thread" --from "$from" --expects answer "$@" ${park_args} \
          --worker gh-action --body-file "$body" --write --no-push); then
      echo "::error::new-message отказал — в тред ${thread} НЕ сообщено."
      return 1
    fi
    git -C .comms-fallback add -A
    # --no-verify НЕ послабление стиля: worktree'ы делят `.git`, а с ним и хуки,
    # установленные `pnpm install` в главном чекауте; коммит почты звал бы pre-commit
    # главного репозитория (`Command "turbo" not found`, прогон 30521214435).
    git -C .comms-fallback commit --no-verify -m "$commit_msg"
    if comms_push "$attempt"; then
      echo "Доставлено в тред ${thread}."
      return 0
    fi
  done
  echo "::error::Не удалось сообщить в тред ${thread} за ${COMMS_PUSH_ATTEMPTS} попыток."
  return 1
}
