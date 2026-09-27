#!/usr/bin/env bash
# $POSTGRES_* in single quotes are expanded by sh inside the db container, not here.
# shellcheck disable=SC2016
# Restore a backup made by deploy/backup.sh into the running production stack.
#
#   bash deploy/restore.sh --identity ~/qoima-backup-key.txt qoima-2026-09-27_030000.dump.age
#   age -d -i key.txt FILE.dump.age | ssh SERVER 'bash ~/qoima/deploy/restore.sh -'
#   bash deploy/restore.sh --into-main qoima-2026-09-27_030000.dump
#
# By default the dump goes into a separate database qoima_restore_check (recreated each time),
# and the row counts of the main tables are printed next to the main database: this checks
# that the backup is usable without touching real data.
#
# --into-main replaces the main database. It asks to type the database name, stops the api
# for the time of the restore and restores in one transaction (on error nothing changes).
#
# Input: an encrypted .age file (needs --identity or AGE_IDENTITY_FILE: the PRIVATE key, keep it
# off the server; decrypt on the owner's computer and pipe through ssh as shown above),
# or an already decrypted dump file, or "-" for a decrypted dump on stdin.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose -f "$SCRIPT_DIR/docker-compose.prod.yml")
CHECK_DB="qoima_restore_check"
TABLES=(users products customers receipts receipt_lines sales sale_lines
  stock_movements stock_balances business_settings document_counters)

fail() {
  echo "ОШИБКА: $*" >&2
  exit 1
}

usage() {
  echo "Использование: $0 [--into-main] [--identity ФАЙЛ_КЛЮЧА] ФАЙЛ.dump.age | ФАЙЛ.dump | -" >&2
  exit 2
}

INTO_MAIN=0
IDENTITY="${AGE_IDENTITY_FILE:-}"
INPUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --into-main) INTO_MAIN=1 ;;
    --identity)
      [ $# -ge 2 ] || usage
      IDENTITY="$2"
      shift
      ;;
    -h | --help) usage ;;
    -) INPUT="-" ;;
    -*) usage ;;
    *) INPUT="$1" ;;
  esac
  shift
done
[ -n "$INPUT" ] || usage

if [ "$INPUT" != "-" ]; then
  [ -r "$INPUT" ] || fail "нельзя прочитать файл $INPUT"
fi
if [[ "$INPUT" == *.age ]]; then
  command -v age >/dev/null || fail "не найдена программа age"
  [ -n "$IDENTITY" ] || fail "для .age нужен приватный ключ: --identity ФАЙЛ или AGE_IDENTITY_FILE"
  [ -r "$IDENTITY" ] || fail "нельзя прочитать файл ключа $IDENTITY"
fi

# Writes the decrypted dump to stdout.
read_dump() {
  if [[ "$INPUT" == *.age ]]; then
    age -d -i "$IDENTITY" "$INPUT"
  elif [ "$INPUT" = "-" ]; then
    cat
  else
    cat "$INPUT"
  fi
}

# psql in the db container as the superuser from .env.prod; extra arguments are passed on.
# </dev/null everywhere except pg_restore: `exec -T` would otherwise eat a dump piped to stdin.
db_psql() {
  "${COMPOSE[@]}" exec -T -e PGOPTIONS="-c client_min_messages=warning" db \
    sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$@"' psql "$@" </dev/null
}

main_db_name() {
  "${COMPOSE[@]}" exec -T db sh -c 'printf %s "$POSTGRES_DB"' </dev/null
}

# Prints the row count of every table in TABLES, one per line ("-" if the table is missing).
row_counts() {
  local db="$1" table
  for table in "${TABLES[@]}"; do
    if [ "$(db_psql -d "$db" -tA -c "SELECT to_regclass('public.$table') IS NOT NULL")" = "t" ]; then
      db_psql -d "$db" -tA -c "SELECT count(*) FROM public.$table"
    else
      echo "-"
    fi
  done
}

"${COMPOSE[@]}" ps --status running --services </dev/null | grep -qx db || fail "контейнер db не запущен"
MAIN_DB="$(main_db_name)"

if [ "$INTO_MAIN" -eq 1 ]; then
  { : </dev/tty; } 2>/dev/null || fail "для --into-main нужен терминал для подтверждения; передайте файл, а не stdin через ssh"
  echo "ВНИМАНИЕ: база $MAIN_DB будет ЗАМЕНЕНА данными из бэкапа. Все изменения после бэкапа пропадут."
  printf "Для подтверждения введите имя базы (%s): " "$MAIN_DB"
  read -r answer </dev/tty
  [ "$answer" = "$MAIN_DB" ] || fail "подтверждение не совпало, ничего не изменено"

  echo "Останавливаю api..."
  "${COMPOSE[@]}" stop api </dev/null >/dev/null 2>&1
  trap 'echo "Запускаю api..."; "${COMPOSE[@]}" start api </dev/null >/dev/null 2>&1' EXIT

  echo "Восстанавливаю в $MAIN_DB (одна транзакция)..."
  read_dump | "${COMPOSE[@]}" exec -T db sh -c \
    'pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB"' ||
    fail "восстановление не удалось, база $MAIN_DB не изменена"
  echo "Строк в таблицах $MAIN_DB:"
  paste <(printf '%s\n' "${TABLES[@]}") <(row_counts "$MAIN_DB") | column -t
  echo "OK: база $MAIN_DB восстановлена"
  exit 0
fi

echo "Создаю пустую базу $CHECK_DB..."
db_psql -d postgres -c "DROP DATABASE IF EXISTS $CHECK_DB WITH (FORCE)" -c "CREATE DATABASE $CHECK_DB"

echo "Восстанавливаю бэкап в $CHECK_DB..."
read_dump | "${COMPOSE[@]}" exec -T -e CHECK_DB="$CHECK_DB" db sh -c \
  'pg_restore --no-owner --exit-on-error -U "$POSTGRES_USER" -d "$CHECK_DB"' ||
  fail "pg_restore завершился с ошибкой"

echo
echo "Количество строк: $CHECK_DB (из бэкапа) и $MAIN_DB (текущая база)"
mapfile -t restored < <(row_counts "$CHECK_DB")
mapfile -t current < <(row_counts "$MAIN_DB")
differ=0
rows=("таблица $CHECK_DB $MAIN_DB")
for i in "${!TABLES[@]}"; do
  mark=""
  if [ "${restored[$i]}" != "${current[$i]}" ]; then
    mark="*"
    differ=1
  fi
  rows+=("${TABLES[$i]} ${restored[$i]} ${current[$i]}$mark")
done
printf '%s\n' "${rows[@]}" | column -t
echo
if [ "$differ" -eq 0 ]; then
  echo "OK: бэкап восстановлен, количество строк совпадает с текущей базой"
else
  echo "OK: бэкап восстановлен. Отличия (*) нормальны, если после бэкапа в базе что-то менялось"
fi
echo "Проверочная база $CHECK_DB пересоздаётся при следующем запуске; удалить её сейчас:"
echo "  docker compose -f deploy/docker-compose.prod.yml exec db sh -c 'dropdb -U \"\$POSTGRES_USER\" $CHECK_DB'"
