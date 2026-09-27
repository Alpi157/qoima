#!/usr/bin/env bash
# Encrypted backup of the production database. Runs on the server (cron, see deploy/README.md).
#
#   AGE_RECIPIENTS_FILE=/etc/qoima/backup.pub bash deploy/backup.sh
#
# pg_dump -Fc (custom format, already compressed) from the db container, encrypted with the
# owner's age PUBLIC key. The private key is never on the server: a stolen backup is useless.
# Files: $BACKUP_DIR/qoima-YYYY-MM-DD_HHMMSS.dump.age, older than $RETENTION_DAYS days are removed.
#
# Environment:
#   AGE_RECIPIENTS_FILE  required, file with the age public key(s) (age1...)
#   BACKUP_DIR           default /var/backups/qoima
#   RETENTION_DAYS       default 14

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/qoima}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
RECIPIENTS="${AGE_RECIPIENTS_FILE:-}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
fail() {
  log "ОШИБКА: $*" >&2
  exit 1
}

command -v age >/dev/null || fail "не найдена программа age (sudo apt install -y age)"
command -v docker >/dev/null || fail "не найден docker"
[ -n "$RECIPIENTS" ] || fail "не задан AGE_RECIPIENTS_FILE (файл с открытым ключом age)"
[ -r "$RECIPIENTS" ] || fail "нельзя прочитать файл ключа $RECIPIENTS"
if grep -q "AGE-SECRET-KEY" "$RECIPIENTS"; then
  fail "$RECIPIENTS содержит ПРИВАТНЫЙ ключ. На сервере должен быть только открытый (age1...)"
fi
grep -q "^age1" "$RECIPIENTS" || fail "в $RECIPIENTS нет открытого ключа age (строка age1...)"
[ "$RETENTION_DAYS" -ge 1 ] 2>/dev/null || fail "RETENTION_DAYS должно быть целым числом >= 1"

mkdir -p "$BACKUP_DIR" || fail "не удалось создать каталог $BACKUP_DIR"

TARGET="$BACKUP_DIR/qoima-$(date '+%Y-%m-%d_%H%M%S').dump.age"
PARTIAL="$TARGET.partial"
trap 'rm -f "$PARTIAL"' EXIT

log "Бэкап базы в $TARGET"
# pipefail: an error of pg_dump (or of docker) fails the whole pipeline, not only of age.
if ! docker compose -f "$COMPOSE_FILE" exec -T db \
  sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' </dev/null |
  age -R "$RECIPIENTS" -o "$PARTIAL"; then
  fail "pg_dump или шифрование завершились с ошибкой, бэкап не создан"
fi
[ -s "$PARTIAL" ] || fail "получился пустой файл, бэкап не создан"
mv "$PARTIAL" "$TARGET"
log "OK: $(basename "$TARGET"), $(du -h "$TARGET" | cut -f1)"

# -mtime +N means "older than N+1 whole days", so N = RETENTION_DAYS - 1 keeps RETENTION_DAYS days.
OLD=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'qoima-*.dump.age' -mtime +"$((RETENTION_DAYS - 1))" -print -delete)
if [ -n "$OLD" ]; then
  log "Удалены бэкапы старше $RETENTION_DAYS дней:"
  while IFS= read -r file; do echo "  $file"; done <<<"$OLD"
fi
log "Бэкапов в $BACKUP_DIR: $(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'qoima-*.dump.age' | wc -l)"
