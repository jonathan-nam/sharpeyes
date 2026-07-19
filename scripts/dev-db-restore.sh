#!/usr/bin/env bash
#
# Rebuild the LOCAL dev database from a snapshot written by scripts/dev-db-snapshot.sh.
#
#   ./scripts/dev-db-restore.sh                       restore dev-snapshots/latest.sql.gz
#   ./scripts/dev-db-restore.sh dev-2026....sql.gz    restore a specific one
#
# An untested backup is a file you believe is a backup, so this is meant to be rehearsed, not
# saved for the emergency.
set -euo pipefail
cd "$(dirname "$0")/.."
# Same reason as dev-db-snapshot.sh: the dev stack and the snapshots live in the main checkout,
# not in whatever worktree this script was invoked from.
cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

DB_USER=maplestorage
# Overridable so the restore can be rehearsed against a throwaway database instead of the one
# holding your dev data. That rehearsal is the only thing that makes this a backup.
DB_NAME=${DB_NAME:-maplestorage}
dump="${1:-dev-snapshots/latest.sql.gz}"

[ -f "$dump" ] || {
  echo "no such snapshot: $dump" >&2
  exit 1
}

echo "About to overwrite the local '${DB_NAME}' database with $(basename "$(readlink -f "$dump")")."
read -r -p "Type 'restore' to continue: " confirm
[ "$confirm" = restore ] || {
  echo "aborted"
  exit 1
}

# The backend holds open connections, and its locks make the dump's DROP TABLEs hang rather than
# fail, which reads as a wedged restore. Stop it for the duration.
docker compose stop backend >/dev/null
trap 'docker compose start backend >/dev/null' EXIT

docker compose up -d postgres >/dev/null
# ON_ERROR_STOP so a mid-file failure exits non-zero instead of leaving a half-restored database
# that looks fine. The dump's leading DROPs use --if-exists, so a fresh empty DB is also fine.
gunzip -c "$dump" | docker compose exec -T postgres \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 --quiet >/dev/null

docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
  "select (select count(*) from characters) characters,
          (select count(*) from screenshots) screenshots,
          (select count(*) from character_token_count) token_counts,
          (select count(*) from boss_clear) boss_clears;"
echo "restored from $dump"
