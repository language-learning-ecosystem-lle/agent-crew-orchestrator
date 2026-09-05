#!/usr/bin/env bash
# Забор операторской руки в дереве роли (тред 062, постановка curator 2026-09-05).
#
# ЗАЧЕМ СУЩЕСТВУЕТ. Полевой случай 2026-09-05: john дописал строку в файл внутри дерева
# роли, и блок из шести команд применился НАПОЛОВИНУ — `.npmrc` записался по правам группы,
# а `git add/commit` отказал `detected dubious ownership`, потому что дерево принадлежит
# другому пользователю. Состояние после: дерево изменено, изменение не зафиксировано, и
# никто об этом не объявлял. Поймано только чтением вывода; в длинном блоке ушло бы
# незамеченным.
#
# ЧТО ДЕЛАЕТ. По каждому пути называет владельца ближайшего СУЩЕСТВУЮЩЕГО предка (файла
# может ещё не быть — его как раз собираются создать) и отказывает ПО ИМЕНИ, если владелец
# не ты. Отказ несёт имя владельца, имя того, кем ты работаешь, и готовую форму «сделать
# это целиком из-под владельца».
#
# ЧЕГО НЕ ДЕЛАЕТ НАМЕРЕННО: ничего не пишет, ничего не запускает и не зовёт `sudo`. Это
# дверь ПЕРЕД блоком операторских команд, а не исполнитель блока — иначе она сама стала бы
# тем, что применяет половину. Правило, ради которого она стоит, живёт в
# `docs/box-setup.md` §0b и сильнее её: забор проверяет один путь, правило запрещает
# смешивать руки.
#
# Прогон руками: bash scripts/operator-tree-guard.sh ~/projects/<репозиторий>
# В сюите:       packages/agent-protocol/src/operator-tree-guard.process.test.ts
#                (он же гоняет scripts/operator-tree-guard.test.sh)
set -uo pipefail

readonly SELF="operator-tree-guard.sh"

usage() {
  cat <<'EOF'
usage: bash scripts/operator-tree-guard.sh <путь> [<путь> …]

Называет владельца каждого пути и отказывает по имени, если владелец не ты.
Ничего не пишет и ничего не запускает.

Ставится ПЕРВОЙ строкой операторского блока и сцепляется с ним через `&&`:

  bash scripts/operator-tree-guard.sh ~/projects/<репозиторий> && <команда>

Коды выхода: 0 — все пути твои; 1 — хотя бы один чужой (или ты работаешь под root);
             2 — ошибка вызова.
EOF
}

# Ближайший существующий предок пути: правку начинают и с несуществующего файла.
nearest_existing() { # <путь>
  local probe="$1" parent
  while [ ! -e "$probe" ]; do
    parent="$(dirname -- "$probe")"
    [ "$parent" = "$probe" ] && break
    probe="$parent"
  done
  [ -e "$probe" ] || return 1
  printf '%s\n' "$probe"
}

hand_over_form() { # <владелец> <дерево>
  cat <<EOF
       Работай ЦЕЛИКОМ из-под владельца — и запись файла, и git одной рукой:
         sudo -u $1 env PATH=<каталог интерпретатора>:/usr/local/bin:/usr/bin:/bin \\
           GH_TOKEN="\$(sudo grep -m1 '^GH_TOKEN=' <secrets.env владельца> | cut -d= -f2-)" \\
           git -C $2 <команда>
       Редактировать файлы в дереве роли из-под себя нельзя ни \`cat >>\`, ни редактором:
       запись пройдёт по правам группы, а git откажет — это и есть половина работы молча.
       Правило целиком — docs/box-setup.md §0b.
EOF
}

main() {
  case "${1-}" in
    -h | --help)
      usage
      return 0
      ;;
  esac

  if [ "$#" -eq 0 ]; then
    printf '%s: не назван ни один путь.\n\n' "$SELF" >&2
    usage >&2
    return 2
  fi

  local me me_uid
  me="$(id -un)"
  me_uid="$(id -u)"

  if [ "$me_uid" = "0" ]; then
    printf 'ОТКАЗ · ты работаешь под root (`id -u` → 0).\n' >&2
    printf '       Записи от root оставят в дереве роли файлы `root:root`, и следующий такт\n' >&2
    printf '       роли упрётся в них уже без тебя. Выйди из-под root и назови владельца явно.\n' >&2
    return 1
  fi

  local failed=0 path anchor owner_line owner owner_uid
  for path in "$@"; do
    if ! anchor="$(nearest_existing "$path")"; then
      printf '%s: не существует ни путь `%s`, ни один из его предков.\n' "$SELF" "$path" >&2
      failed=2
      continue
    fi

    if ! owner_line="$(stat -c '%u %U' -- "$anchor" 2>/dev/null)"; then
      printf '%s: владельца `%s` прочитать не удалось (`stat` отказал).\n' "$SELF" "$anchor" >&2
      failed=2
      continue
    fi
    owner_uid="${owner_line%% *}"
    owner="${owner_line#* }"

    if [ "$owner_uid" = "$me_uid" ]; then
      if [ "$anchor" = "$path" ]; then
        printf 'ok · %s — владелец `%s`, это ты.\n' "$path" "$owner"
      else
        printf 'ok · %s — ещё нет; ближайший предок `%s` принадлежит `%s`, это ты.\n' \
          "$path" "$anchor" "$owner"
      fi
      continue
    fi

    printf 'ОТКАЗ · %s — владелец `%s` (uid %s), а ты `%s` (uid %s).\n' \
      "$path" "$owner" "$owner_uid" "$me" "$me_uid" >&2
    if [ "$anchor" != "$path" ]; then
      printf '       Самого пути ещё нет; владельца назвал ближайший предок `%s`.\n' "$anchor" >&2
    fi
    hand_over_form "$owner" "$anchor" >&2
    [ "$failed" = "0" ] && failed=1
  done

  return "$failed"
}

main "$@"
