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
# человек), и не пушит без `--push`.
set -euo pipefail

readonly SELF="split-package.sh"

usage() {
  cat <<'EOF'
usage: scripts/split-package.sh --tag <tag> [--prefix <path>] [--ref <ref>] [--base <ref>]
                               [--allow-behind] [--remote <name>] [--push]

  --tag <tag>       имя тега, который будет создан на срезанном коммите. Обязателен.
  --prefix <path>   каталог пакета в этом репозитории (по умолчанию packages/agent-protocol).
  --ref <ref>       ревизия, с которой режется пакет (по умолчанию HEAD).
  --base <ref>      линия, которую артефакт обязан нести целиком (по умолчанию origin/main).
  --allow-behind    резать, даже если --ref не несёт всю линию --base: отказ станет громким
                    предупреждением с тем же списком коммитов.
  --remote <name>   удалённый для --push (по умолчанию origin).
  --push            отправить тег на удалённый. Без флага — только локальный тег.

Схема имён тегов пакета agent-protocol: `agent-protocol-v<MAJOR.MINOR.PATCH>`, где версия —
это `version` из package.json пакета НА СРЕЗАЕМОЙ РЕВИЗИИ. Скрипт печатает обе и отказывает,
если они разошлись: тег, который врёт о версии, читает чужой репозиторий.
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
# артефакт БЕЗ уже слитой в main работы: так тег agent-protocol-v0.2.0 уехал в LLE без
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
else
  echo "$SELF: ревизии '$base' в этом репозитории нет — проверка «срез несёт всю линию» ПРОПУЩЕНА (назови линию через --base)"
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
echo "$SELF: тег '$tag' создан на $split"

if [ "$push" = "yes" ]; then
  git push "$remote" "refs/tags/$tag"
  echo "$SELF: тег '$tag' отправлен на '$remote'"
else
  echo "$SELF: тег НЕ отправлен (нет --push); отправка: git push $remote refs/tags/$tag"
fi
