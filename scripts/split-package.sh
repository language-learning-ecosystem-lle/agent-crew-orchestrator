#!/usr/bin/env bash
# Рез подпакета в тег, корень которого — САМ ПАКЕТ (тред 018).
#
# Зачем это существует. Чужой репозиторий ставит наш пакет зависимостью вида
# `github:<owner>/<repo>#<tag>`, а такая зависимость кладёт в `node_modules/<name>`
# КОРЕНЬ репозитория. Корень этого репозитория — воркспейс (`agent-protocol-workspace`),
# и пакета по пути `node_modules/agent-protocol/src/cli.ts` у потребителя не будет вовсе.
# Поэтому наружу едет не `main`, а тег, дерево которого начинается с содержимого
# `packages/agent-protocol` — его и режет эта команда.
#
# Почему скриптом, а не рукой: резать придётся на каждый бамп, а ручная
# последовательность в чьей-то голове — это не воспроизводимость, это память.
#
# ЧЕГО СКРИПТ НЕ ДЕЛАЕТ НАМЕРЕННО: не двигает существующий тег (перенос тега —
# force-операция над тем, на что уже мог сослаться чужой репозиторий; такое решает
# человек), и не пушит без `--push`. Из «не двигает» растёт и жёсткость проверки линии:
# ошибка реза не чинится, она живёт ровно столько, сколько тег.
set -euo pipefail

readonly SELF="split-package.sh"

usage() {
  cat <<'EOF'
usage: scripts/split-package.sh --tag <tag> [--prefix <path>] [--ref <ref>] [--base <ref>]
                               [--allow-behind] [--remote <name>] [--push]

  --tag <tag>       имя тега, который будет создан на срезанном коммите. Обязателен.
  --prefix <path>   каталог пакета в этом репозитории (по умолчанию packages/agent-protocol).
  --ref <ref>       ревизия, с которой режется пакет (по умолчанию HEAD).
  --base <ref>      линия, которую артефакт обязан нести целиком И в которую --ref обязан быть
                    влит (по умолчанию origin/main).
  --allow-behind    резать, даже если --ref не несёт всю линию --base: отказ станет громким
                    предупреждением с тем же списком коммитов. Второй проверки — «--ref влит
                    в --base» — этот флаг НЕ снимает: тег не переносится, и тег на невлитом
                    коде остался бы навсегда.
  --remote <name>   удалённый для --push (по умолчанию origin).
  --push            отправить тег на удалённый. Без флага — только локальный тег.

Линия проверяется В ОБЕ СТОРОНЫ: срез обязан нести всю линию --base (иначе наружу уедет
артефакт без уже слитой работы) И сам обязан быть в неё влит (иначе наружу уедет код, не
прошедший merge-гарды). Заодно скрипт называет теги этого пакета, чьё дерево в --base не
встречается: двигать их нельзя, а знать про них рука обязана. Тег, чьё дерево вообще не
читается (объект повреждён или недостижим), называется ОТДЕЛЬНОЙ строкой и непригодным не
объявляется: про него не сказано ничего ни в ту, ни в другую сторону.

Схема имён тегов пакета agent-protocol: `agent-protocol-v<MAJOR.MINOR.PATCH>`, где версия —
это `version` из package.json пакета НА СРЕЗАЕМОЙ РЕВИЗИИ. Скрипт печатает обе и отказывает,
если они разошлись: тег, который врёт о версии, читает чужой репозиторий.

Скрипт печатает также ВЕРСИЮ СХЕМЫ ПРОТОКОЛА, которую пишет срез (`CURRENT_PROTOCOL_VERSION`
из его исходников): по номеру тега её не видно, а переезд пина через ступень, где она
сдвинулась, роняет CI потребителя. Сверить её с числом потребителя ДО переезда пина:
`agent-protocol schema version --package-ref <тег> --repo <потребитель> --ref main`.
EOF
}

die() {
  echo "$SELF: $*" >&2
  exit 1
}

tag=""
prefix="packages/agent-protocol"
ref="HEAD"
base="origin/main"
allow_behind="no"
remote="origin"
push="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) [ $# -ge 2 ] || die "флаг --tag назван без значения"; tag="$2"; shift 2 ;;
    --prefix) [ $# -ge 2 ] || die "флаг --prefix назван без значения"; prefix="$2"; shift 2 ;;
    --ref) [ $# -ge 2 ] || die "флаг --ref назван без значения"; ref="$2"; shift 2 ;;
    --base) [ $# -ge 2 ] || die "флаг --base назван без значения"; base="$2"; shift 2 ;;
    --allow-behind) allow_behind="yes"; shift ;;
    --remote) [ $# -ge 2 ] || die "флаг --remote назван без значения"; remote="$2"; shift 2 ;;
    --push) push="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "неизвестный аргумент '$1'" ;;
  esac
done

[ -n "$tag" ] || { usage >&2; die "--tag обязателен: без имени тега резать нечего и ссылаться чужому репозиторию не на что"; }

git rev-parse --git-dir >/dev/null 2>&1 || die "это не рабочее дерево git — резать нечего"

resolved="$(git rev-parse --verify "$ref^{commit}" 2>/dev/null)" ||
  die "ревизия '$ref' не разрешается в коммит этого репозитория"

git cat-file -e "$resolved:$prefix" 2>/dev/null ||
  die "каталога '$prefix' нет на ревизии '$ref' ($resolved) — проверь --prefix"

git cat-file -e "$resolved:$prefix/package.json" 2>/dev/null ||
  die "в '$prefix' на ревизии '$ref' нет package.json — это не пакет, и ставиться такой срез не будет"

if git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null; then
  die "тег '$tag' уже есть в этом репозитории и НЕ переносится: на него мог уже сослаться чужой pin. Возьми следующую версию"
fi

manifest="$(git show "$resolved:$prefix/package.json")"
name="$(printf '%s' "$manifest" | node -e 'let s="";process.stdin.on("data",(c)=>{s+=c}).on("end",()=>{process.stdout.write(String(JSON.parse(s).name??""))})')"
version="$(printf '%s' "$manifest" | node -e 'let s="";process.stdin.on("data",(c)=>{s+=c}).on("end",()=>{process.stdout.write(String(JSON.parse(s).version??""))})')"

[ -n "$name" ] || die "у пакета в '$prefix' нет поля name — под каким именем он ляжет в node_modules, неизвестно"
[ -n "$version" ] || die "у пакета '$name' нет поля version — схема имён тегов опирается на неё"

expected="$name-v$version"
if [ "$tag" != "$expected" ]; then
  die "имя тега '$tag' расходится с пакетом: package.json на ревизии '$ref' говорит name='$name' version='$version', то есть тег этого среза — '$expected'. Либо бампни версию пакета, либо назови тег так, как он есть"
fi

# НЕСЁТ ЛИ СРЕЗ ВСЮ ЛИНИЮ. Рез с головы ветки, чья база отстала, молча выпускает наружу
# артефакт БЕЗ уже слитой в main работы: так тег agent-protocol-v0.2.0 уехал к потребителю без
# коммита треда 016 (замер 2026-08-21). Молчащая дверь хуже отсутствующей — считаем сами
# и называем коммиты поимённо, а не оставляем это глазу человека на каждом бампе.
if base_resolved="$(git rev-parse --verify --quiet "$base^{commit}" 2>/dev/null)"; then
  if ! git merge-base --is-ancestor "$base_resolved" "$resolved" 2>/dev/null; then
    behind="$(git log --oneline "$resolved..$base_resolved" -- "$prefix")"
    if [ -n "$behind" ]; then
      said="ревизия '$ref' ($resolved) НЕ несёт линию '$base' ($base_resolved): в срез не попадёт уже слитая работа по '$prefix' —
$(printf '%s' "$behind" | sed 's/^/  /')
Пересядь на '$base' (rebase ветки бампа) или скажи --allow-behind, если срез с отставшей линии — это то, чего ты хочешь"
      [ "$allow_behind" = "yes" ] || die "$said"
      echo "$SELF: ВНИМАНИЕ (--allow-behind): $said" >&2
    else
      echo "$SELF: линия '$base' ушла вперёд '$ref', но '$prefix' те коммиты не трогают — на срез это не влияет"
    fi
  fi

  # ВЛИТА ЛИ САМА РЕВИЗИЯ (тред 095). Проверка выше односторонняя: она ловит рез с ревизии,
  # ОТСТАВШЕЙ от линии, и по построению молчит про рез с ревизии, УШЕДШЕЙ вперёд и в линию не
  # влитой, — голова ветки бампа несёт всю линию, и первая проверка проходит. Так
  # agent-protocol-v0.2.8 срезан 2026-08-30 с головы PR #155 за 45 секунд ДО его открытия:
  # тег на коде, который через merge-гарды этого контура не проходил — ни круга ревью, ни
  # зелёных чеков на влитой голове, ни гарда доков власти. Цена постоянная: существующий тег
  # скрипт не двигает (см. выше), значит ложный тег живёт вечно и ждёт чужого pin.
  if ! git merge-base --is-ancestor "$resolved" "$base_resolved" 2>/dev/null; then
    ahead="$(git log --oneline "$base_resolved..$resolved" -- "$prefix")"
    if [ -n "$ahead" ]; then
      unmerged="коммиты по '$prefix', которых в '$base' нет:
$(printf '%s' "$ahead" | sed 's/^/  /')"
    else
      unmerged="по '$prefix' невлитых коммитов нет, но сама ревизия в '$base' не влита — дерево среза линией не подтверждено"
    fi
    die "ревизия '$ref' ($resolved) НЕ ВЛИТА в линию '$base' ($base_resolved): срез уехал бы наружу с кодом, не прошедшим merge-гарды этого контура — ни круга ревью, ни зелёных чеков на влитой голове, ни гарда доков власти. $unmerged
Дождись мержа своего PR и режь с '$base' (--ref '$base'). Флага «всё равно режь» здесь нет намеренно: тег не переносится, и ложный жил бы вечно. Тег не создан"
  fi

  # ТЕГИ, ЧЬЁ ДЕРЕВО В ЛИНИИ НЕ ВСТРЕЧАЕТСЯ (тред 095). Дверь выше закрыта на будущее, но уже
  # срезанные теги двигать нельзя — значит про них можно только СКАЗАТЬ, и сказать в момент,
  # когда рука ведёт следующий бамп и смотрит в вывод. Мера — по дереву, а не по имени: тег
  # пригоден тогда, когда его дерево (корень среза = сам пакет) равно '$prefix' на каком-то
  # коммите линии, то есть это содержимое через дверь merge проходило.
  line_trees="$(git rev-list "$base_resolved" -- "$prefix" |
    awk -v suffix=":$prefix" '{ print $0 suffix }' |
    git cat-file --batch-check='%(objectname) %(objecttype)' 2>/dev/null |
    awk '$2 == "tree" { print $1 }' | sort -u)"
  suspect=""
  unreadable=""
  measured="no"
  seen_tags="no"
  for known in $(git tag --list "$name-v*"); do
    seen_tags="yes"
    # ТРЕТЬЕ СОСТОЯНИЕ: ДЕРЕВО ТЕГА НЕ ЧИТАЕТСЯ (тред 117). Тег, чей объект повреждён или
    # недостижим в этом чекауте, раньше пропускался молча — и исход тихого пропуска был
    # неотличим от исхода честной проверки: оба давали «тег не назван», то есть «всё в
    # порядке». Про такой тег не сказано НИЧЕГО ни в ту, ни в другую сторону, и это само по
    # себе новость: в перечень непригодных он не зачисляется (мера его не мерила), но и
    # молчать о нём нельзя — молчание здесь читается как подтверждение.
    if ! known_tree="$(git rev-parse --verify --quiet "$known^{tree}")"; then
      unreadable="$unreadable $known"
      continue
    fi
    measured="yes"
    printf '%s\n' "$line_trees" | grep -qxF "$known_tree" || suspect="$suspect $known"
  done
  if [ -n "$unreadable" ]; then
    echo "$SELF: ВНИМАНИЕ: теги пакета '$name', ДЕРЕВО КОТОРЫХ НЕ ЧИТАЕТСЯ (объект повреждён или недостижим в этом чекауте) — про их пригодность не сказано ничего, ни в ту, ни в другую сторону:$unreadable" >&2
  fi
  if [ -n "$suspect" ]; then
    echo "$SELF: ВНИМАНИЕ: теги пакета '$name', чьё дерево в линии '$base' НЕ встречается (срезаны с невлитого; запинить такой — поехать на коде, не прошедшем merge-гарды):$suspect" >&2
  elif [ "$measured" = "yes" ] && [ -n "$unreadable" ]; then
    echo "$SELF: теги пакета '$name': дерево каждого ЧИТАЕМОГО встречается в линии '$base' (о нечитаемых сказано выше)"
  elif [ "$measured" = "yes" ]; then
    echo "$SELF: теги пакета '$name': дерево каждого встречается в линии '$base'"
  elif [ "$seen_tags" = "no" ]; then
    echo "$SELF: тегов пакета '$name' в этом репозитории ещё нет — перечислять нечего"
  fi
else
  echo "$SELF: ревизии '$base' в этом репозитории нет — проверки «срез несёт всю линию», «ревизия влита в линию» и перечень тегов, чьё дерево в линии не встречается, ПРОПУЩЕНЫ (назови линию через --base)"
fi

# КАКУЮ ВЕРСИЮ СХЕМЫ ПИШЕТ ЭТОТ ТЕГ (тред 028). Номер тега — это версия ПАКЕТА, и по ней
# не видно, сдвинулась ли под ним схема протокола: `v0.2.1` писала 17, `v0.2.2` — уже 18,
# а заголовок ступени читался как чистый релизный бамп. Потребитель, переехавший пином
# через такую ступень, узнаёт об этом красным CI на живом `main` (замер 2026-08-22 у
# потребителя: 37 секунд после мержа). Поэтому число едет ВМЕСТЕ с объявлением тега — рука, ведущая
# бамп, читает его здесь, а не ищет в исходниках; сверяется оно с числом потребителя
# командой `agent-protocol schema version --package-ref <тег> --repo <потребитель>`.
schema_version=""
schema_source=""
for candidate in "src/schema/version.ts" "$prefix/src/schema/version.ts"; do
  if git cat-file -e "$resolved:$candidate" 2>/dev/null; then
    schema_source="$candidate"
    schema_version="$(git show "$resolved:$candidate" |
      sed -n 's/^export const CURRENT_PROTOCOL_VERSION[[:space:]]*=[[:space:]]*\([0-9][0-9]*\)[[:space:]]*;.*/\1/p' |
      head -n 1)"
    break
  fi
done

if [ -z "$schema_source" ]; then
  echo "$SELF: в '$prefix' на ревизии '$ref' нет src/schema/version.ts — этот срез версию схемы протокола не объявляет"
elif [ -z "$schema_version" ]; then
  # Файл есть, а числа в нём не нашлось: это не «нечего печатать», а нечитаемое
  # объявление — молчать здесь значит выдать неизвестное за отсутствующее.
  die "в '$schema_source' на ревизии '$ref' нет объявления 'CURRENT_PROTOCOL_VERSION = <n>' — версию схемы этого среза прочитать нечем, тег не создан"
else
  echo "$SELF: protocolVersion этот тег пишет: $schema_version (из '$schema_source')"
fi

echo "$SELF: режу '$prefix' с $ref ($resolved) → тег '$tag' (пакет $name@$version)"

split="$(git subtree split --prefix="$prefix" "$resolved" 2>/dev/null | tail -n 1)"
[ -n "$split" ] || die "git subtree split не вернул коммит — рез не состоялся"

# Дверь, которая молчит, хуже отсутствующей: срез проверяется ПО ДЕРЕВУ, а не по
# факту, что команда не упала. Корень среза обязан быть корнем пакета.
git cat-file -e "$split:package.json" 2>/dev/null ||
  die "в срезе $split нет package.json в корне — это не корень пакета, тег не создан"

echo "$SELF: срез $split, верхний уровень его дерева:"
git ls-tree --name-only "$split" | sed 's/^/  /'

git tag "$tag" "$split"
if [ -n "$schema_version" ]; then
  # Число повторяется в ИТОГОВОЙ строке намеренно: именно её копируют в тред как
  # объявление тега, и объявление без версии схемы — то самое молчание, которым
  # оплачен красный CI потребителя.
  echo "$SELF: тег '$tag' создан на $split (пакет $name@$version, protocolVersion $schema_version)"
else
  echo "$SELF: тег '$tag' создан на $split (пакет $name@$version, версия схемы не объявлена)"
fi
echo "$SELF: перед переездом пина сверь оба числа: agent-protocol schema version --package-ref '$tag' --repo <репозиторий-потребитель> --ref main"

if [ "$push" = "yes" ]; then
  git push "$remote" "refs/tags/$tag"
  echo "$SELF: тег '$tag' отправлен на '$remote'"
else
  echo "$SELF: тег НЕ отправлен (нет --push); отправка: git push $remote refs/tags/$tag"
fi
