#!/usr/bin/env bash
# Проверка смотрителя имени соседнего дома (тред 064, постановка curator 2026-09-05, §4
# «Проверяемость»). Разделы — по пунктам постановки; проверок в разделе столько, сколько у
# пункта исходов (число не пишется здесь литералом: оно устарело бы молча).
#
# Прогон руками: bash .github/scripts/foreign-name-watch.test.sh
# В сьюте поднимается процессом (`src/roles/foreign-name-watch.process.test.ts`) — по той
# же причине, что `notifier-mute.test.sh`: молчаливо сломанный смотритель неотличим от
# исправного до следующего возврата класса, а это уже поздно.
set -uo pipefail

cd "$(dirname "$0")"
# shellcheck source=./foreign-name-watch.sh
source ./foreign-name-watch.sh

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

# Фикстура набора и исключений — СВОЯ, а не боевая: тест судит ПРАВИЛО, и боевой набор
# правится отдельно от него (иначе новое имя соседа роняло бы юнит).
NAMES="$DIR/names"
printf '# comment\n\nlanguage-learning-ecosystem\nLLE\n' > "$NAMES"
ALLOW="$DIR/allow"
printf 'docs/box-setup.md\t-\tадрес живого ящика\nagent-protocol.json\t/home/lle/projects\tпути ящика\n' > "$ALLOW"

TREE="$DIR/tree"
mkdir -p "$TREE/docs" "$TREE/src"

export GITHUB_REPOSITORY='language-learning-ecosystem-lle/agent-crew-orchestrator'

# 1. ВХОЖДЕНИЕ ИМЕНИ СОСЕДА ВНУТРИ СОБСТВЕННОГО АДРЕСА — НЕ НАХОДКА.
#    Ровно тот случай, из-за которого наивный поиск давал два ложных из трёх.
printf 'см. https://github.com/language-learning-ecosystem-lle/agent-crew-orchestrator/pull/1\n' > "$TREE/src/own.ts"
check "имя соседа внутри собственного адреса — не находка" "" \
  "$(foreign_name_watch_scan "$TREE" "$NAMES" "$ALLOW")"

# 2. ТО ЖЕ ИМЯ ВНЕ СОБСТВЕННОГО АДРЕСА — НАХОДКА.
printf 'фикс приехал из language-learning-ecosystem\n' > "$TREE/src/foreign.ts"
check "то же имя вне собственного адреса — находка" \
  "src/foreign.ts	1	фикс приехал из language-learning-ecosystem" \
  "$(foreign_name_watch_scan "$TREE" "$NAMES" "$ALLOW")"

# Контроль РАБОЧЕГО ШАБЛОНА на границе слова: `LLE` без `\b` ловит `CALLED` (полевой
# случай), а строчное `lle` — пользователь живого ящика.
printf 'const CALLED = 1; // /home/lle/projects\n' > "$TREE/src/boundary.ts"
check "граница слова: CALLED и /home/lle находкой не являются" \
  "src/foreign.ts	1	фикс приехал из language-learning-ecosystem" \
  "$(foreign_name_watch_scan "$TREE" "$NAMES" "$ALLOW")"

# 3. ИСКЛЮЧЕНИЕ ПО ПУТИ РАБОТАЕТ — и оно же не расползается на соседний путь.
printf 'оба контура: language-learning-ecosystem и наш\n' > "$TREE/docs/box-setup.md"
check "исключение по пути гасит находку" \
  "src/foreign.ts	1	фикс приехал из language-learning-ecosystem" \
  "$(foreign_name_watch_scan "$TREE" "$NAMES" "$ALLOW")"
# Сужение содержанием строки: в том же файле ДРУГОЕ вхождение обязано звонить.
printf '{"a": "/home/lle/projects/language-learning-ecosystem"}\n{"b": "LLE"}\n' > "$TREE/agent-protocol.json"
check "сужение содержанием: строка ящика молчит, другая — звонит" \
  "agent-protocol.json	2	{\"b\": \"LLE\"}
src/foreign.ts	1	фикс приехал из language-learning-ecosystem" \
  "$(foreign_name_watch_scan "$TREE" "$NAMES" "$ALLOW")"

# 3b. ИСКЛЮЧЕНИЕ, АДРЕСОВАННОЕ НОМЕРОМ СТРОКИ, В КОДЕ ОТСУТСТВУЕТ — грепом по самому
#     боевому файлу исключений (как `review-delivery.test.sh` грепает литерал `077`).
#     Мёртвое исключение по номеру не краснеет и не звонит — оно тихо перестаёт совпадать.
check "в боевом списке исключений нет адресации номером строки" "" \
  "$(grep -nE '^[^#[:space:]][^\t]*:[0-9]+' ./foreign-name-watch.allow || true)"

# 4. ПУСТОЙ НАБОР НАХОДОК — ПИСЬМА НЕТ ВОВСЕ.
EMPTY="$DIR/tree-empty"; mkdir -p "$EMPTY"
printf 'ничего чужого тут нет\n' > "$EMPTY/README.md"
check "пустой набор — находок нет" "" "$(foreign_name_watch_scan "$EMPTY" "$NAMES" "$ALLOW")"

# 5. ОТКАЗ ЗАМЕРА — ПИСЬМО ЕСТЬ И НЕСЁТ «НЕ ПРОЧИТАНО» С ПРИЧИНОЙ (Т4).
OUT="$(foreign_name_watch_scan "$DIR/нет-такого-дерева" "$NAMES" "$ALLOW")"; RC=$?
check "отказ замера — ненулевой код" "1" "$RC"
check "отказ замера — причина названа" \
  "дерево не прочитано: каталог $DIR/нет-такого-дерева не существует" "$OUT"
check "письмо об отказе говорит «НЕ ПРОЧИТАНО» и почему" \
  '🏠 **Имя соседнего дома — НЕ ПРОЧИТАНО: дерево не прочитано.**' \
  "$(foreign_name_watch_unread_letter 'дерево не прочитано' abc123 https://run | head -1)"
# Отказ собственного адреса — тот же класс: молчаливый пустой набор запрещён. Замер идёт
# ВНЕ репозитория: иначе fallback на `git remote get-url origin` ответил бы за среду, и
# ветвь отказа осталась бы непроверенной.
# `GIT_DIR` в никуда тут обязателен: `TMPDIR` сессии роли стои́т ВНУТРИ чекаута, и без
# него `git remote get-url origin` из временного каталога находит НАШ же remote —
# ветвь отказа осталась бы непроверенной, а тест зелёным.
OUT="$(cd "$DIR" && GIT_DIR="$DIR/нет-такого-git" GITHUB_REPOSITORY='' foreign_name_watch_own_tokens '')"; RC=$?
check "собственный адрес не определён — отказ, а не пустой набор" "1" "$RC"
check "и он назван по имени" \
  "собственный адрес не определён: ни GITHUB_REPOSITORY, ни remote origin не дали owner/repo" "$OUT"

# 5b. ОТКАЗ САМОГО ПЕРЕЧИСЛИТЕЛЯ — ТРЕТИЙ ОТКАЗ Т4, И ОН ОТДЕЛЁН ОТ «СОВПАДЕНИЙ НЕТ».
#     Проверка 5 покрывает ДРУГУЮ ветвь — «каталога нет», она отрабатывает ДО вызова `find`.
#     Здесь дерево существует и читается, а спотыкается сам обход: молчаливый пустой вывод
#     тут — ровно «класс не найден» вместо «я не смотрела».
#     Обход и чтение подменяются функциями (bash берёт функцию раньше внешней команды):
#     ветвь обязана проверяться ОДИНАКОВО под любым пользователем, а под root никакой
#     `chmod` каталог не закроет — тест, зелёный только у непривилегированного, ветвь не
#     покрывает, он её угадывает.
find() { printf 'find: %s/secret: Permission denied\n' "$1" >&2; return 1; }
OUT="$(foreign_name_watch_scan "$TREE" "$NAMES" "$ALLOW")"; RC=$?
unset -f find
check "отказ обхода — ненулевой код, а не пустой набор" "1" "$RC"
check "отказ обхода назван по имени и несёт настоящую ошибку" "да" \
  "$(case "$OUT" in 'перечислитель отказал: обход дерева '*'; find: '*'Permission denied') echo да ;; *) echo "нет: $OUT" ;; esac)"

# Та же ветвь со стороны ЧТЕНИЯ: `grep` на нечитаемом файле отдаёт 2, `xargs` сворачивает
# это в 123 — ровно тот же код, что и «совпадений нет». Разводит их только stderr.
xargs() { printf 'grep: %s: Permission denied\n' "$TREE/src/foreign.ts" >&2; return 123; }
OUT="$(foreign_name_watch_scan "$TREE" "$NAMES" "$ALLOW")"; RC=$?
unset -f xargs
check "отказ чтения файлов — отказ, хотя код совпадает с «совпадений нет»" "1" "$RC"
check "отказ чтения назван по имени и несёт настоящую ошибку" "да" \
  "$(case "$OUT" in 'перечислитель отказал: чтение файлов дерева '*'; grep: '*'Permission denied') echo да ;; *) echo "нет: $OUT" ;; esac)"

# И ТОТ ЖЕ ОТКАЗ ЖИВЬЁМ — воспроизведение ревьюера (вердикт по PR #280): подкаталог без
# прав. Под root права никого не останавливают, поэтому живая часть идёт ДОПОЛНЕНИЕМ к
# двум проверкам выше и под root объявленно пропускается, а не тихо зеленеет.
if [ "$(id -u)" != 0 ]; then
  DENIED="$DIR/tree-denied"
  mkdir -p "$DENIED/secret"
  printf 'приехало из language-learning-ecosystem\n' > "$DENIED/secret/hidden.txt"
  chmod 000 "$DENIED/secret"
  OUT="$(foreign_name_watch_scan "$DENIED" "$NAMES" "$ALLOW")"; RC=$?
  chmod 755 "$DENIED/secret"
  check "живой подкаталог без прав — отказ, а не «новых мест 0»" "1" "$RC"
  check "и живой отказ назван перечислителем" "да" \
    "$(case "$OUT" in 'перечислитель отказал: '*) echo да ;; *) echo "нет: $OUT" ;; esac)"
else
  echo "skip · живой подкаталог без прав: прогон под root, права не останавливают никого"
fi

# 6. НОВОЕ ОТНОСИТЕЛЬНО РОДИТЕЛЯ — ПИСЬМО; БЫВШЕЕ У РОДИТЕЛЯ — МОЛЧАНИЕ, НО СТРОКА
#    «остаётся» в теле (Т7). Ключ места — путь + текст, БЕЗ номера строки: сдвиг строки
#    новым местом не является.
HEAD_F="$DIR/head"; PARENT_F="$DIR/parent"
printf 'src/foreign.ts\t7\tиз language-learning-ecosystem\nsrc/new.ts\t2\tLLE\n' > "$HEAD_F"
printf 'src/foreign.ts\t1\tиз language-learning-ecosystem\n' > "$PARENT_F"
check "новым считается только место, которого у родителя не было" \
  "src/new.ts	2	LLE" "$(foreign_name_watch_new_places "$HEAD_F" "$PARENT_F")"
check "сдвинувшееся место новым не считается — оно в «остаётся»" \
  "src/foreign.ts	7	из language-learning-ecosystem" \
  "$(foreign_name_watch_known_places "$HEAD_F" "$PARENT_F")"

# 7. ТЕЛО ПИСЬМА НЕСЁТ ПУТЬ + СТРОКУ + ТЕКСТ (Т5) и хвост «остаётся» (Т7).
foreign_name_watch_new_places "$HEAD_F" "$PARENT_F" > "$DIR/fresh"
foreign_name_watch_known_places "$HEAD_F" "$PARENT_F" > "$DIR/known"
LETTER="$(foreign_name_watch_letter "$DIR/fresh" "$DIR/known" abc123 https://run)"
check "тело называет место путём, номером и текстом" "да" \
  "$(case "$LETTER" in *'- `src/new.ts:2` — `LLE`'*) echo да ;; *) echo нет ;; esac)"
check "тело несёт хвост «остаётся»" "да" \
  "$(case "$LETTER" in *'## Остаётся с прошлого раза'*'- `src/foreign.ts:7`'*) echo да ;; *) echo нет ;; esac)"
check "тело называет число новых мест" "да" \
  "$(case "$LETTER" in *'новых мест — 1'*) echo да ;; *) echo нет ;; esac)"

# Прочитанный родитель оговорки не рождает: строка «НЕ ПРОЧИТАН» в обычном письме —
# ложная тревога, и она обязана отсутствовать, а не «обычно отсутствовать».
check "у прочитанного родителя оговорки в теле нет" "нет" \
  "$(case "$LETTER" in *'Родитель коммита НЕ ПРОЧИТАН'*) echo да ;; *) echo нет ;; esac)"

# 8. РОДИТЕЛЬ НЕ ПРОЧИТАН — ПИСЬМО ГРОМЧЕ, А НЕ ТИШЕ (Т4 поверх Т7). Дельту считать не от
# чего, поэтому новыми называются ВСЕ места, и причина стои́т в теле: молчание здесь было бы
# «класс не найден» вместо «я не смотрела».
LETTER_NP="$(foreign_name_watch_letter "$HEAD_F" /dev/null abc123 https://run 'корневой коммит — родителя нет')"
check "оговорка о непрочитанном родителе названа причиной" "да" \
  "$(case "$LETTER_NP" in *'Родитель коммита НЕ ПРОЧИТАН: корневой коммит — родителя нет'*) echo да ;; *) echo нет ;; esac)"
check "при непрочитанном родителе новыми названы все места" "да" \
  "$(case "$LETTER_NP" in *'новых мест — 2'*'- `src/foreign.ts:7`'*'- `src/new.ts:2`'*) echo да ;; *) echo нет ;; esac)"

if [ "$FAILED" = 0 ]; then
  echo "смотритель имени соседнего дома: все проверки прошли"
else
  echo "смотритель имени соседнего дома: ЕСТЬ ОТКАЗЫ"
fi
exit "$FAILED"
