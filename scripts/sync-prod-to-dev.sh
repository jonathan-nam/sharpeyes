#!/usr/bin/env bash
#
# Copy your account and one other allowed account from prod into the local dev database.
#
#   ./scripts/sync-prod-to-dev.sh         # dry run: reads prod, prints what it would load, loads nothing
#   ./scripts/sync-prod-to-dev.sh --yes   # also replaces those dev accounts' data with it
#
# ONLY the accounts named in SYNC_ACCOUNTS, at most two, and nobody else's data ever reaches dev. Set
# it in the main checkout's .env (gitignored), as prod user id : dev user id pairs:
#
#   SYNC_ACCOUNTS=<prod-id>:<dev-id>,<prod-id>:<dev-id>
#
# The ids are configuration and not code because this repo is public. A dev id is an account that
# has signed in to the dev stack once; prod ids are in prod's users table.
#
# How it keeps everybody else out:
#   1. prod is dumped read-only, without sign-in secrets or the caches of other people's names, into
#      a temporary directory that is deleted on exit, however the script ends.
#   2. that dump is restored into a SCRATCH database, never dev, where every other account is deleted
#      and whatever hung off them goes by each foreign key's own rule (sync-prod-to-dev-scope.sql).
#   3. only then is anything copied into dev, in one transaction that rolls back unless every table
#      gained exactly what the scoped copy holds and every foreign key holds (sync-prod-to-dev-load.sql).
# The dev accounts' own sign-in rows are kept, so you stay signed in. Other dev accounts are untouched.
#
# Dev is snapshotted into dev-snapshots/ before it is written to.
#
#   SYNC_PROD_HOST  default ubuntu@api.sharpeyes.app. Its host key must already be known: ssh to it once
#                   by hand, or name the box the way known_hosts already does.
#   SYNC_PROD_KEY   default ~/.ssh/lightsail.pem
#
# ./scripts/sync-prod-to-dev-test.sh proves the scoping keeps nobody else, on a throwaway database.
set -euo pipefail

MAX_ACCOUNTS=2
CONFIRMED=no
for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRMED=yes ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")/.."
# The main checkout, which holds .env, dev-snapshots/ and the compose project, from a worktree too.
ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"

PAIRS="${SYNC_ACCOUNTS:-$(sed -n 's/^SYNC_ACCOUNTS=//p' "$ROOT/.env" 2>/dev/null | tail -1)}"
PAIRS="${PAIRS%\"}"
PAIRS="${PAIRS#\"}"
if [ -z "$PAIRS" ]; then
  echo "SYNC_ACCOUNTS is not set, so there is no account this may copy." >&2
  echo "Put the prod:dev id pairs in $ROOT/.env (it is gitignored):" >&2
  echo "  SYNC_ACCOUNTS=<prod-id>:<dev-id>,<prod-id>:<dev-id>" >&2
  exit 1
fi
if ! [[ "$PAIRS" =~ ^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+:[A-Za-z0-9_-]+)*$ ]]; then
  echo "SYNC_ACCOUNTS must be prod-id:dev-id pairs separated by commas." >&2
  exit 1
fi
IFS=',' read -ra PAIR_LIST <<<"$PAIRS"
if [ "${#PAIR_LIST[@]}" -gt "$MAX_ACCOUNTS" ]; then
  echo "SYNC_ACCOUNTS names ${#PAIR_LIST[@]} accounts. This copies at most $MAX_ACCOUNTS." >&2
  exit 1
fi
if [ "$(printf '%s\n' "${PAIR_LIST[@]}" | tr ':' '\n' | sort | uniq -d)" != "" ]; then
  echo "SYNC_ACCOUNTS names one id twice." >&2
  exit 1
fi

HOST="${SYNC_PROD_HOST:-ubuntu@api.sharpeyes.app}"
KEY="${SYNC_PROD_KEY:-$HOME/.ssh/lightsail.pem}"
DC=(docker compose --project-directory "$ROOT" -f "$ROOT/docker-compose.yml")
dev_psql() { "${DC[@]}" exec -T postgres psql -U sharpeyes -d sharpeyes -v ON_ERROR_STOP=1 -qtA "$@"; }
SCRATCH="sync_scratch_$(date -u +%Y%m%d%H%M%S)"
scratch_psql() { "${DC[@]}" exec -T postgres psql -U sharpeyes -d "$SCRATCH" -v ON_ERROR_STOP=1 -qtA "$@"; }

WORK="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK"
  "${DC[@]}" exec -T postgres psql -U sharpeyes -d postgres -qc "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The tables never copied: sign-in rows and secrets, seeded catalogs (remapped instead), migration
# history, caches of other people's names, and users (its two rows are updated, never replaced).
NOT_COPIED="'users','flyway_schema_history','boss_catalog','drop_catalog','token_catalog','boss_drop',
  'boss_drop_amount','redemption_rule','token_clear_amount','character_sprite','discord_username',
  'ign_sprite','sync_dev_catalog'"

echo "==> reading prod (read-only dump)"
# shellcheck disable=SC2016 # expanded on the box, from its own .env
ssh -n -o BatchMode=yes -i "$KEY" "$HOST" '
  set -e
  cd sharpeyes
  set -a; . ./.env; set +a
  IMAGE_TAG=unused docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
    pg_dump -U "$DB_USERNAME" -Fc \
      --exclude-table-data="auth_*" --exclude-table-data=discord_username \
      --exclude-table-data=ign_sprite --exclude-table-data=character_sprite \
      "${DB_NAME:-sharpeyes}"
' >"$WORK/prod.dump"
if [ "$(wc -c <"$WORK/prod.dump")" -lt 10000 ]; then
  echo "the prod dump is $(wc -c <"$WORK/prod.dump") bytes, which is not a database. Stopping." >&2
  exit 1
fi

echo "==> scoping it in a scratch database, $SCRATCH"
"${DC[@]}" exec -T postgres psql -U sharpeyes -d postgres -qc "CREATE DATABASE $SCRATCH" >/dev/null
"${DC[@]}" exec -T postgres pg_restore -U sharpeyes -d "$SCRATCH" --no-owner --no-privileges <"$WORK/prod.dump"

version() { "$@" -c "SELECT version FROM flyway_schema_history WHERE success AND version IS NOT NULL
  ORDER BY installed_rank DESC LIMIT 1"; }
PROD_V="$(version scratch_psql)"
DEV_V="$(version dev_psql)"
if [ "$PROD_V" != "$DEV_V" ]; then
  echo "prod is at migration V$PROD_V and dev at V$DEV_V. Bring dev to prod's version first." >&2
  exit 1
fi

# Dev's own catalog rows, which every catalog reference in the copy is moved onto.
scratch_psql -c "CREATE TABLE sync_dev_catalog (kind TEXT, key TEXT, id TEXT)"
dev_psql -c "\copy (SELECT 'boss_catalog', boss_key, id::text FROM boss_catalog
  UNION ALL SELECT 'drop_catalog', drop_key, id::text FROM drop_catalog
  UNION ALL SELECT 'token_catalog', name, id::text FROM token_catalog) TO STDOUT" \
  | scratch_psql -c "\copy sync_dev_catalog FROM STDIN"

cat scripts/sync-prod-to-dev-sweep.sql scripts/sync-prod-to-dev-scope.sql \
  | scratch_psql -v pairs="$PAIRS" -f -

TABLES="$(scratch_psql -c "SELECT string_agg(table_name, ' ' ORDER BY table_name)
  FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  AND table_name NOT LIKE 'auth\_%' AND table_name NOT IN ($NOT_COPIED)")"

# Per-table row counts of the copy: what the load must add, and what this run prints.
for t in $TABLES; do
  printf '%s\t%s\n' "$t" "$(scratch_psql -c "SELECT count(*) FROM public.$t")"
done >"$WORK/expected.tsv"

echo
echo "the copy holds:"
awk -F'\t' '$2 > 0 { printf "  %-28s %s\n", $1, $2 }' "$WORK/expected.tsv"
echo "for these dev accounts:"
for pair in "${PAIR_LIST[@]}"; do
  scratch_psql -c "SELECT '  ' || u.id || '  characters=' || (SELECT count(*) FROM characters c WHERE c.user_id = u.id)
    || ' parties=' || (SELECT count(*) FROM party p WHERE p.user_id = u.id) FROM users u WHERE u.id = '${pair#*:}'"
done
echo

if [ "$CONFIRMED" != yes ]; then
  echo "dry run. Add --yes to replace those dev accounts' data with this."
  exit 0
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$ROOT/dev-snapshots"
echo "==> snapshotting dev to dev-snapshots/pre-sync-$STAMP.sql.gz"
"${DC[@]}" exec -T postgres pg_dump -U sharpeyes sharpeyes | gzip >"$ROOT/dev-snapshots/pre-sync-$STAMP.sql.gz"

DUMP_TABLES=()
for t in $TABLES; do DUMP_TABLES+=(-t "public.$t"); done
"${DC[@]}" exec -T postgres pg_dump -U sharpeyes -d "$SCRATCH" --data-only "${DUMP_TABLES[@]}" >"$WORK/data.sql"
scratch_psql -c "SELECT format('UPDATE users SET world_type = %L, main_character_id = %L WHERE id = %L;',
  world_type, main_character_id, id) FROM users" >"$WORK/settings.sql"

echo "==> loading into dev (one transaction)"
{
  cat scripts/sync-prod-to-dev-sweep.sql
  sed -n '1,/^-- @expected$/p' scripts/sync-prod-to-dev-load.sql
  echo "COPY sync_expected FROM STDIN;"
  cat "$WORK/expected.tsv"
  echo '\.'
  sed -n '/^-- @expected$/,/^-- @data$/{/^-- @/!p}' scripts/sync-prod-to-dev-load.sql
  cat "$WORK/data.sql"
  echo "SET search_path = public;"
  cat "$WORK/settings.sql"
  sed -n '/^-- @data$/,$p' scripts/sync-prod-to-dev-load.sql
} | dev_psql -v pairs="$PAIRS" -f -

echo
echo "done. Sign in to the dev stack as either account to see it."
