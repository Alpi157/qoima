#!/usr/bin/env bash
# Copy new encrypted backups from the server to the owner's computer. Runs on the owner's computer.
#
#   QOIMA_SERVER=deploy@qoima.example.kz bash pull-backups.sh
#
# Only files that are not here yet are copied; local copies are never deleted, so they outlive
# the 14 days kept on the server. The files stay encrypted; the private key is needed to restore.
#
# Environment:
#   QOIMA_SERVER  required, user@host for ssh
#   REMOTE_DIR    default /var/backups/qoima
#   LOCAL_DIR     default ~/qoima-backups

set -euo pipefail

SERVER="${QOIMA_SERVER:-}"
REMOTE_DIR="${REMOTE_DIR:-/var/backups/qoima}"
LOCAL_DIR="${LOCAL_DIR:-$HOME/qoima-backups}"

fail() {
  echo "ОШИБКА: $*" >&2
  exit 1
}

[ -n "$SERVER" ] || fail "не задан QOIMA_SERVER (например, deploy@qoima.example.kz)"
command -v rsync >/dev/null || fail "не найдена программа rsync (sudo apt install -y rsync)"
mkdir -p "$LOCAL_DIR"

echo "Забираю бэкапы с $SERVER:$REMOTE_DIR в $LOCAL_DIR"
rsync -av --ignore-existing -e ssh \
  --include='qoima-*.dump.age' --exclude='*' \
  "$SERVER:$REMOTE_DIR/" "$LOCAL_DIR/" ||
  fail "rsync завершился с ошибкой"

# Names sort by date and time. ls, not find -printf: also works on macOS.
# shellcheck disable=SC2012
BACKUPS="$(cd "$LOCAL_DIR" && ls -1 qoima-*.dump.age 2>/dev/null | sort || true)"
[ -n "$BACKUPS" ] || fail "в $LOCAL_DIR нет ни одного бэкапа"
echo "OK: последний бэкап $(echo "$BACKUPS" | tail -n 1), всего $(echo "$BACKUPS" | wc -l | tr -d ' ')"
