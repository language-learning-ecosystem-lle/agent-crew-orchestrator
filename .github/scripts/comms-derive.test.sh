#!/usr/bin/env bash
# Проверка тела генератора производных (`comms-derive.sh`, тред 075).
#
# Тело переехало из воркфлоу в скрипт ровно ради того, чтобы его можно было
# менять, НЕ трогая копию в ветке `comms`, — и вместе с этим оно впервые стало
# прогоняемым отдельно от GitHub Actions. Проверяется здесь не сборка
# производных (это `derive.test.ts`), а КАРКАС шага, у которого каждая
# проверенная строка стоит на своём полевом отказе:
#   * код `derive` доносится до конца шага и становится кодом шага (тред 060);
#   * красный `derive` НЕ отменяет коммит и push уже собранных производных;
#   * расхождение считается по `git status --porcelain` — он видит
#     неотслеживаемое, `git diff` не видит (тред 005);
#   * отклонённый push пересобирает производные поверх свежей головы и меряет
#     код `derive` заново (тред 042);
#   * исчерпанный потолок push'ей выходит своим кодом 1, а не кодом `derive`.
#
# Прогон: bash .github/scripts/comms-derive.test.sh
# В джобу `checks` НЕ заведён — по той же причине, что и `comms-push.test.sh`:
# это тест, который гоняется руками при правке своего файла, а не шаг, от
# которого зависит зелёность каждого PR.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

FAILED=0
check() { # <что> <ожидалось> <получено>
  if [ "$2" = "$3" ]; then
    echo "ok   · $1"
  else
    echo "FAIL · $1: ожидалось '$2', получено '$3'"
    FAILED=1
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Чекаут `main` для скрипта — только то, что он оттуда читает: общая дверь
# push'а. Дверь берётся НАСТОЯЩАЯ: классификатор отказов проверяет свой
# собственный тест, а здесь важно, что скрипт зовёт именно его.
mkdir -p "$WORK/code/.github/scripts"
cp "$HERE/comms-push.sh" "$WORK/code/.github/scripts/"

STUB_DIR="$WORK/stub"
mkdir -p "$STUB_DIR"

# `git`, `pnpm` и `sleep` подменяются исполняемыми файлами в PATH: скрипт
# запускается ОТДЕЛЬНЫМ bash (так его зовёт воркфлоу), поэтому функциями шелла
# их не подменить, а пауза двери в реальных секундах сделала бы прогон
# минутным.
cat > "$STUB_DIR/git" <<'EOF'
#!/usr/bin/env bash
# Журнал вызовов — по нему тест спрашивает «коммитили ли вообще».
printf '%s\n' "$*" >> "$LOG"
case "$1" in
  status)
    # Очередь ответов: по строке на вызов, пустая строка = расхождения нет.
    n=$(( $(cat "$STATE/status_n") + 1 )); echo "$n" > "$STATE/status_n"
    sed -n "${n}p" "$STATE/status_seq"
    ;;
  push)
    n=$(( $(cat "$STATE/push_n") + 1 )); echo "$n" > "$STATE/push_n"
    rc="$(sed -n "${n}p" "$STATE/push_seq")"
    [ "$rc" = 0 ] && exit 0
    # Дословный текст удалённой стороны — дверь классифицирует именно его.
    echo " ! [rejected]        HEAD -> comms (fetch first)" >&2
    exit 1
    ;;
esac
exit 0
EOF

cat > "$STUB_DIR/pnpm" <<'EOF'
#!/usr/bin/env bash
printf 'pnpm %s\n' "$*" >> "$LOG"
n=$(( $(cat "$STATE/derive_n") + 1 )); echo "$n" > "$STATE/derive_n"
exit "$(sed -n "${n}p" "$STATE/derive_seq")"
EOF

printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB_DIR/sleep"
chmod +x "$STUB_DIR"/*

run() { # <status-очередь> <push-очередь> <derive-очередь> → RC, OUT, LOG_TEXT
  local state="$WORK/state"
  rm -rf "$state" "$WORK/mail"
  mkdir -p "$state" "$WORK/mail/agent-comms"
  printf '%s\n' "$1" > "$state/status_seq"
  printf '%s\n' "$2" > "$state/push_seq"
  printf '%s\n' "$3" > "$state/derive_seq"
  echo 0 > "$state/status_n"; echo 0 > "$state/push_n"; echo 0 > "$state/derive_n"
  : > "$state/log"
  OUT="$(cd "$WORK/mail" && PATH="$STUB_DIR:$PATH" STATE="$state" LOG="$state/log" \
    MAIL="$WORK/mail/agent-comms" CODE="$WORK/code" bash "$HERE/comms-derive.sh" 2>&1)"
  RC=$?
  LOG_TEXT="$(cat "$state/log")"
}

# 1. Расхождения нет, `derive` доволен — тихий зелёный, коммита нет.
run "" "0" "0"
check "чисто: код 0" 0 "$RC"
check "чисто: не коммитит" 0 "$(printf '%s\n' "$LOG_TEXT" | grep -c '^commit')"

# 2. Расхождения нет, `derive` отказал — код 2 доносится до конца шага и назван
#    строкой `::error::`, а не проглочен тихим зелёным (тред 060).
run "" "0" "2"
check "красный derive без расхождения: код 2" 2 "$RC"
check "красный derive без расхождения: назван" 1 "$(printf '%s' "$OUT" | grep -c '::error::.*derive отказал кодом 2')"

# 3. Расхождение видно ТОЛЬКО по `status --porcelain` (файлы неотслеживаемые,
#    `git diff` здесь молчал бы) — собрано, закоммичено, запушено (тред 005).
run "?? agent-comms/INDEX.md" "0" "0"
check "неотслеживаемое расхождение: код 0" 0 "$RC"
check "неотслеживаемое расхождение: коммит есть" 1 "$(printf '%s\n' "$LOG_TEXT" | grep -c '^commit -m chore(comms): rebuild derived')"
check "неотслеживаемое расхождение: push есть" 1 "$(printf '%s\n' "$LOG_TEXT" | grep -c '^push ')"

# 4. НЕСУЩЕЕ (тред 060): `derive` отказал, но собранное уехало в ветку — красный
#    прогон оставляет после себя запушенные производные, а не пустую ветку.
run " M agent-comms/INDEX.md" "0" "2"
check "красный derive с расхождением: код 2" 2 "$RC"
check "красный derive с расхождением: push всё равно есть" 1 "$(printf '%s\n' "$LOG_TEXT" | grep -c '^push ')"

# 5. Гонка за голову: push отклонён, ветка пересобрана поверх свежей головы,
#    `derive` прогнан заново, вторая попытка проходит (тред 042).
run "$(printf 'M agent-comms/INDEX.md\nM agent-comms/INDEX.md')" "$(printf '1\n0')" "$(printf '0\n0')"
check "гонка: код 0 со второй попытки" 0 "$RC"
check "гонка: пересборка поверх origin/comms" 1 "$(printf '%s\n' "$LOG_TEXT" | grep -c '^reset --hard origin/comms')"
check "гонка: derive прогнан дважды" 2 "$(printf '%s\n' "$LOG_TEXT" | grep -c '^pnpm ')"
check "гонка: попытка названа в логе" 1 "$(printf '%s' "$OUT" | grep -c 'попытка 2')"

# 6. Потолок push'ей исчерпан — свой код 1 (он старше отказа `derive`) и своя
#    строка отказа с числом попыток.
run "$(yes 'M agent-comms/INDEX.md' | head -7)" "$(yes 1 | head -7)" "$(yes 0 | head -7)"
check "потолок исчерпан: код 1" 1 "$RC"
check "потолок исчерпан: назван числом попыток" 1 "$(printf '%s' "$OUT" | grep -c '::error::не удалось запушить производные за 6 попыток')"

# 7. Дверь окружения: без MAIL/CODE скрипт отказывает ПО ИМЕНИ, а не падает
#    где-то внутри на пустом пути.
OUT="$(PATH="$STUB_DIR:$PATH" bash "$HERE/comms-derive.sh" 2>&1)"; RC=$?
check "без MAIL: отказ ненулевым кодом" 1 "$RC"
check "без MAIL: назван по имени" 1 "$(printf '%s' "$OUT" | grep -c 'MAIL')"

exit "$FAILED"
