#!/usr/bin/env bash
#
# Snapshot the LOCAL dev database to dev-snapshots/, so `docker compose down -v` stops being a
# one-way door. Restore with scripts/dev-db-restore.sh.
#
# This is not scripts/backup-db.sh. That one is production, nightly, to S3. This one is your
# laptop, on demand, to a gitignored directory, and it is the only copy of hand-curated dev data
# (real characters, real parsed screenshots) that no migration or seed can rebuild.
#
# dev-snapshots/ is gitignored on purpose: the repo is public, and the dump carries a Clerk user
# ID and raw parse results. Copy it somewhere off this machine if you want real durability.
set -euo pipefail
cd "$(dirname "$0")/.."
# There is one dev stack per machine, and it belongs to the main checkout: compose names the
# project after the directory, so running this from a worktree would spin up a second, empty
# postgres and snapshot that. It would also drop the file in a directory that gets deleted with
# the worktree.
cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

OUT_DIR=dev-snapshots
DB_USER=maplestorage
DB_NAME=maplestorage

psql_q() { docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1"; }

# The failure this guard exists for: you wipe the volume, the stack comes back with an empty
# schema, this script runs, and the fresh empty dump becomes `latest`. Timestamped filenames mean
# the old dump is still on disk, but `latest` would point at nothing and you would not notice
# until you needed it. A dev DB worth snapshotting has characters in it.
chars=$(psql_q "select count(*) from characters" || echo 0)
if [ "${chars:-0}" -lt 1 ]; then
  echo "characters table is empty. Refusing to snapshot: this looks like a wiped DB, not your data." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="${OUT_DIR}/dev-${stamp}.sql.gz"

# Whole database, schema included, not just the user tables. Restoring a data-only dump means
# getting FK insert order and the catalog/Flyway state right by hand, and the whole dump is a few
# hundred KB. --clean --if-exists lets it restore over a live database without dropping it.
docker compose exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" \
  --clean --if-exists --no-owner --no-privileges | gzip >"$dump"

size=$(stat -c %s "$dump")
if [ "$size" -lt 1024 ]; then
  echo "dump is only ${size} bytes. pg_dump wrote nothing and the pipe swallowed the error." >&2
  rm -f "$dump"
  exit 1
fi

ln -sfn "$(basename "$dump")" "${OUT_DIR}/latest.sql.gz"

screenshots=$(psql_q "select count(*) from screenshots")
counts=$(psql_q "select count(*) from character_token_count")
clears=$(psql_q "select count(*) from boss_clear")
echo "wrote $dump (${size} bytes)"
echo "  ${chars} characters, ${screenshots} screenshots, ${counts} token counts, ${clears} boss clears"
