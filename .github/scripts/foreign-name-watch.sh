#!/usr/bin/env bash
# СМОТРИТЕЛЬ ИМЕНИ СОСЕДНЕГО ДОМА — ЗВОНИТ, А НЕ КРАСНИТ (тред 064, слово john
# 2026-09-05: «ЗАВОДИМ: СМОТРИТЕЛЬ, НАБОР ИМЁН МИНУС СВОИ АДРЕСА»).
#
# ЗАЧЕМ. Класс 064 — операционное знание соседнего дома в этом дереве — был вычищен
# (6 мест → 0 на живом `origin/main`), приёмка закрыта на `ae4deb13`, И КЛАСС ВЕРНУЛСЯ:
# `1b0b48fb` принёс имя соседа в `packages/**` снова, из PR ЧУЖОГО треда. Греп рукой
# держит класс ровно до следующего пакета — отсюда постоянная машинная проверка.
#
# ПОЧЕМУ ЗВОНОК, А НЕ ОТКАЗ. Слово john дословно: «это гигиена прозы, а не авария.
# Красный PR блокирует чужие треды из-за комментария — цена ложится на все треды сразу,
# а починка всё равно ждёт следующего такта. Звонок дешевле и достаточен.»
#
# ВСЯ ЛОГИКА ЖИВЁТ ЗДЕСЬ, а воркфлоу над ней — тонкий (чекаут, установка, вызов, одна
# доставка): своя поверхность отказа у смотрителя обязана быть меньше, чем у того, за кем
# он следит. Ровно тот же довод, что у `notifier-watch.yml`.
#
# Файл СОРСИТСЯ (воркфлоу и `foreign-name-watch.test.sh`), сам ничего не делает.

# МАШИННЫЕ КАТАЛОГИ — ПЕРЕЧИСЛЕНЫ ЯВНО, А НЕ ПОДРАЗУМЕВАЮТСЯ (Т2). Область — ВСЁ дерево,
# и это замер, а не вкус: второй факт 2026-09-05 — шаблон был верен, а область нет,
# `scripts/**` не смотрел ни один прежний обзор, и имя соседа жило там ещё на приёмке.
FOREIGN_NAME_WATCH_MACHINE_DIRS=(.git node_modules .worktrees .turbo dist coverage .pnpm-store)

# Строка находки обрезается до этой длины: письмо обязано называть место поимённо (Т5), а
# не переносить в ленту минифицированный блоб целиком.
FOREIGN_NAME_WATCH_LINE_MAX=200

# СОБСТВЕННЫЙ АДРЕС — ИЗ СРЕДЫ, ЛИТЕРАЛОМ В КОДЕ НЕ ПИШЕТСЯ (Т3).
# Печатает по токену в строке: `owner/repo`, `owner`, `repo`. Ими же вычитается собственное
# имя из строки ДО поиска: наше имя содержит имя соседа, и наивный поиск даёт два ложных
# из трёх (замерено в треде 064 трижды).
# Отказ — ненулевой код и причина в stdout: молчаливый пустой набор дал бы «класс не
# найден» вместо «я не смотрела» (Т4).
foreign_name_watch_own_tokens() { # [owner/repo]
  local slug="${1:-${GITHUB_REPOSITORY:-}}"
  if [ -z "$slug" ]; then
    slug="$(git remote get-url origin 2>/dev/null)" || slug=''
    # `https://github.com/owner/repo.git` и `git@host:owner/repo.git` — оба к `owner/repo`.
    slug="${slug%.git}"
    slug="$(printf '%s\n' "$slug" | sed -nE 's#^.*[/:]([^/:]+/[^/:]+)$#\1#p')"
  fi
  case "$slug" in
    */*) : ;;
    *)
      printf 'собственный адрес не определён: ни GITHUB_REPOSITORY, ни remote origin не дали owner/repo\n'
      return 1
      ;;
  esac
  printf '%s\n%s\n%s\n' "$slug" "${slug%%/*}" "${slug##*/}"
}

# Имена соседнего дома из файла данных: пустые строки и комментарии отброшены.
foreign_name_watch_names() { # <файл имён>
  if [ ! -r "$1" ]; then
    printf 'набор имён не прочитан: файл %s недоступен\n' "$1"
    return 1
  fi
  sed -E 's/[[:space:]]+$//' "$1" | grep -vE '^[[:space:]]*(#|$)' || true
}

# Правило исключения (Т3): путь-префикс + необязательное сужение содержанием строки.
# Номер строки исключением быть не может — причина в шапке `foreign-name-watch.allow`.
foreign_name_watch_allowed() { # <файл исключений> <путь> <текст строки>
  local allow="$1" path="$2" text="$3" p narrow rest
  [ -r "$allow" ] || return 1
  while IFS=$'\t' read -r p narrow rest; do
    case "$p" in '' | '#'*) continue ;; esac
    case "$path" in "$p" | "$p"/*) : ;; *) continue ;; esac
    if [ "$narrow" = '-' ] || [ -z "$narrow" ]; then return 0; fi
    case "$text" in *"$narrow"*) return 0 ;; esac
  done < "$allow"
  return 1
}

# ЗАМЕР. Печатает находки строками `<путь>\t<номер>\t<текст>`, отсортированными по пути.
# Отказ чтения дерева — ненулевой код и причина в stdout (Т4): «класс не найден» и «я не
# смотрела» обязаны быть разными исходами.
foreign_name_watch_scan() { # <дерево> <файл имён> <файл исключений>
  local tree="$1" names_file="$2" allow="$3"
  if [ ! -d "$tree" ]; then
    printf 'дерево не прочитано: каталог %s не существует\n' "$tree"
    return 1
  fi
  local names own pattern
  names="$(foreign_name_watch_names "$names_file")" || { printf '%s\n' "$names"; return 1; }
  if [ -z "$names" ]; then
    printf 'набор имён пуст: в %s не осталось ни одного имени — смотреть не на что\n' "$names_file"
    return 1
  fi
  own="$(foreign_name_watch_own_tokens)" || { printf '%s\n' "$own"; return 1; }

  # Шаблон — по границе слова и с учётом регистра: причины у каждого имени в файле данных.
  pattern="$(printf '%s\n' "$names" | sed -E 's/[][\\.^$*+?(){}|]/\\&/g; s/^/\\b/; s/$/\\b/' | paste -sd '|' -)"

  # Вычитание собственного адреса — ЛЕНТОЙ sed по токенам, а не глазом: `owner` длиннее
  # `repo`, поэтому токены гасятся в порядке убывания длины (иначе `repo` съел бы кусок
  # `owner` и оставил хвост, который снова совпал бы с именем соседа).
  local blank
  blank="$(printf '%s\n' "$own" | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2- \
    | sed -E 's/[][\\.^$*+?(){}|\/&]/\\&/g; s#^#s/#; s#$#/@/g#')"

  local prune=() d
  for d in "${FOREIGN_NAME_WATCH_MACHINE_DIRS[@]}"; do prune+=(-name "$d" -o); done

  local raw
  if ! raw="$(find "$tree" \( "${prune[@]}" -false \) -prune -o -type f -print0 2>/dev/null \
      | xargs -0 -r grep -nIE "$pattern" /dev/null 2>/dev/null)"; then
    # `grep` без совпадений отдаёт 1 — это не отказ. Отказ дерева ловится проверкой выше;
    # различить их иначе нельзя, и врать «прочитано» здесь дешевле, чем звонить ложно.
    raw=''
  fi

  printf '%s\n' "$raw" | while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    local path line text rest
    path="${hit%%:*}"; rest="${hit#*:}"
    line="${rest%%:*}"; text="${rest#*:}"
    path="${path#"$tree"/}"
    # Собственный адрес гасится и ТОЛЬКО ПОТОМ строка перепроверяется шаблоном.
    if ! printf '%s\n' "$text" | sed -E "$blank" | grep -qE "$pattern"; then continue; fi
    foreign_name_watch_allowed "$allow" "$path" "$text" && continue
    printf '%s\t%s\t%s\n' "$path" "$line" "$(printf '%.*s' "$FOREIGN_NAME_WATCH_LINE_MAX" "$text")"
  done | sort -t$'\t' -k1,1 -k2,2n
}

# КЛЮЧ МЕСТА — ПУТЬ + ТЕКСТ, БЕЗ НОМЕРА СТРОКИ. Номер едет при правке соседнего абзаца, и
# сравнение по нему объявляло бы новым то, что просто сдвинулось.
foreign_name_watch_key() { cut -f1,3; }

# Т7: письмо уходит, когда есть место, которого не было у РОДИТЕЛЯ коммита. Состояния в
# файле для этого заводить не надо — родитель даёт то же самое даром.
foreign_name_watch_new_places() { # <находки головы> <находки родителя>
  local head="$1" parent="$2" keys
  keys="$(foreign_name_watch_key < "$parent" | sort -u)"
  awk -F'\t' -v keys="$keys" '
    BEGIN { n = split(keys, a, "\n"); for (i = 1; i <= n; i++) seen[a[i]] = 1 }
    !(($1 "\t" $3) in seen)' "$head"
}

foreign_name_watch_known_places() { # <находки головы> <находки родителя>
  local head="$1" parent="$2" keys
  keys="$(foreign_name_watch_key < "$parent" | sort -u)"
  awk -F'\t' -v keys="$keys" '
    BEGIN { n = split(keys, a, "\n"); for (i = 1; i <= n; i++) seen[a[i]] = 1 }
    (($1 "\t" $3) in seen)' "$head"
}

# ТЕЛО ПИСЬМА — ЗДЕСЬ, А НЕ В ВОРКФЛОУ: формулировки проверяются прогоном, а не глазом
# (`foreign-name-watch.test.sh`). Правишь текст — правь и тест: он отказывает по имени.
foreign_name_watch_letter() { # <файл новых> <файл остающихся> <sha> <ссылка на прогон>
  local fresh="$1" known="$2" sha="$3" run_url="$4"
  printf '🏠 **Имя соседнего дома в этом дереве: новых мест — %s.**\n\n' "$(wc -l < "$fresh" | tr -d ' ')"
  printf 'голова `%s` · прогон %s\n\n' "$sha" "$run_url"
  printf 'Это ЗВОНОК, а не отказ: прогон смотрителя зелёный, `checks` не тронут, PR не краснеет. Класс — операционное знание соседнего дома в тексте этого репозитория (тред `064-forget-the-consumer`, слово john 2026-08-30 и 2026-09-05).\n\n'
  printf '## Новое относительно родителя коммита\n\n'
  while IFS=$'\t' read -r p l t; do
    [ -n "$p" ] || continue
    printf -- '- `%s:%s` — `%s`\n' "$p" "$l" "$t"
  done < "$fresh"
  if [ -s "$known" ]; then
    printf '\n## Остаётся с прошлого раза (второго письма не рождает — Т7 треда 064)\n\n'
    while IFS=$'\t' read -r p l t; do
      [ -n "$p" ] || continue
      printf -- '- `%s:%s` — `%s`\n' "$p" "$l" "$t"
    done < "$known"
  fi
  printf '\nЗаконные места вычтены машинно: собственный адрес — из `GITHUB_REPOSITORY`, остальное — списком с причинами в `.github/scripts/foreign-name-watch.allow`. Место в списке отсутствует, а стои́т законно — это правка списка с причиной, а не молчание.\n'
}

# Т4: ОТКАЗ САМОЙ ПРОВЕРКИ СЛЫШЕН. Письмо уходит и говорит «НЕ ПРОЧИТАНО» и почему —
# молчаливый `exit 0` при отказе замера запрещён: иначе «класс не найден» вместо «я не
# смотрела». Образец фразы взят у соседа (`notifier-mute.sh`).
foreign_name_watch_unread_letter() { # <причина> <sha> <ссылка на прогон>
  printf '🏠 **Имя соседнего дома — НЕ ПРОЧИТАНО: %s.**\n\n' "$1"
  printf 'голова `%s` · прогон %s\n\n' "$2" "$3"
  printf 'Это НЕ «класс пуст»: смотритель не смотрел. Настоящая ошибка напечатана в логе ЭТОГО прогона — %s, шаг «Замерить и позвонить».\n' "$3"
}
