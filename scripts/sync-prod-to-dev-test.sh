#!/usr/bin/env bash
#
# Prove sync-prod-to-dev-scope.sql keeps nobody but the allowed accounts, on a throwaway database.
#
#   ./scripts/sync-prod-to-dev-test.sh
#
# Prod holds only the two allowed accounts today, so a real sync never exercises the delete. This
# does: three accounts, the third with a party of its own, a seat in the first's party, a people
# link, a drop it logged, a notification and a friend request, and every trace of it has to be gone
# or unbound after the scope runs. Schema and catalogs are dev's, so it tracks every migration.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
DC=(docker compose --project-directory "$ROOT" -f "$ROOT/docker-compose.yml")
DB="sync_scope_test_$(date -u +%Y%m%d%H%M%S)"
psql_on() { "${DC[@]}" exec -T postgres psql -U sharpeyes -d "$1" -v ON_ERROR_STOP=1 -qtA "${@:2}"; }
trap 'psql_on postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1 || true' EXIT

psql_on postgres -c "CREATE DATABASE $DB" >/dev/null
"${DC[@]}" exec -T postgres pg_dump -U sharpeyes -d sharpeyes --schema-only | psql_on "$DB" >/dev/null
"${DC[@]}" exec -T postgres pg_dump -U sharpeyes -d sharpeyes --data-only \
  -t public.boss_catalog -t public.drop_catalog -t public.token_catalog | psql_on "$DB" >/dev/null

psql_on "$DB" <<'SQL'
INSERT INTO users (id, email, created_at) VALUES
  ('keep_a', 'a@example.com', now()), ('keep_b', 'b@example.com', now()), ('other_c', 'c@example.com', now());
INSERT INTO characters (id, user_id, name, position) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'keep_a', 'Thornwick', 0),
  ('00000000-0000-0000-0000-00000000000b', 'keep_b', 'Pellmoor', 0),
  ('00000000-0000-0000-0000-00000000000c', 'other_c', 'Quillon', 0);
INSERT INTO party (id, user_id, character_id, boss_catalog_id) VALUES
  ('00000000-0000-0000-0001-00000000000a', 'keep_a', '00000000-0000-0000-0000-00000000000a',
   (SELECT id FROM boss_catalog ORDER BY boss_key LIMIT 1)),
  ('00000000-0000-0000-0001-00000000000c', 'other_c', '00000000-0000-0000-0000-00000000000c',
   (SELECT id FROM boss_catalog ORDER BY boss_key OFFSET 1 LIMIT 1));
INSERT INTO party_member (id, party_id, name, character_id, linked_character_id, position) VALUES
  ('00000000-0000-0000-0002-0000000000aa', '00000000-0000-0000-0001-00000000000a', 'Thornwick', '00000000-0000-0000-0000-00000000000a', NULL, 0),
  ('00000000-0000-0000-0002-0000000000ab', '00000000-0000-0000-0001-00000000000a', 'Pellmoor', NULL, '00000000-0000-0000-0000-00000000000b', 1),
  ('00000000-0000-0000-0002-0000000000ac', '00000000-0000-0000-0001-00000000000a', 'Quillon', NULL, '00000000-0000-0000-0000-00000000000c', 2),
  ('00000000-0000-0000-0002-0000000000ca', '00000000-0000-0000-0001-00000000000c', 'Thornwick', NULL, '00000000-0000-0000-0000-00000000000a', 1);
INSERT INTO person (id, user_id, name, linked_user_id) VALUES
  ('00000000-0000-0000-0003-0000000000ab', 'keep_a', 'Pellmoor', 'keep_b'),
  ('00000000-0000-0000-0003-0000000000ac', 'keep_a', 'Quillon', 'other_c'),
  ('00000000-0000-0000-0003-0000000000ca', 'other_c', 'Thornwick', 'keep_a');
INSERT INTO party_loot (id, party_id, custom_name, dropped_on, recorded_by_user_id) VALUES
  ('00000000-0000-0000-0004-00000000000a', '00000000-0000-0000-0001-00000000000a', 'Mystery Box', current_date, 'other_c'),
  ('00000000-0000-0000-0004-00000000000c', '00000000-0000-0000-0001-00000000000c', 'Mystery Box', current_date, NULL);
INSERT INTO notification (id, user_id, kind, actor_id, created_at) VALUES
  ('00000000-0000-0000-0005-00000000000a', 'keep_a', 'SALE_RECORDED', 'other_c', now()),
  ('00000000-0000-0000-0005-00000000000c', 'other_c', 'SALE_RECORDED', 'keep_a', now());
INSERT INTO friend_request (id, from_user_id, to_user_id, created_at) VALUES
  ('00000000-0000-0000-0006-0000000000ca', 'other_c', 'keep_a', now());
-- Dev's catalog with ids of its own, as a second database seeds it.
CREATE TABLE sync_dev_catalog (kind TEXT, key TEXT, id TEXT);
INSERT INTO sync_dev_catalog
SELECT 'boss_catalog', boss_key, gen_random_uuid()::text FROM boss_catalog
UNION ALL SELECT 'drop_catalog', drop_key, gen_random_uuid()::text FROM drop_catalog
UNION ALL SELECT 'token_catalog', name, gen_random_uuid()::text FROM token_catalog;
SQL

cat scripts/sync-prod-to-dev-sweep.sql scripts/sync-prod-to-dev-scope.sql \
  | psql_on "$DB" -v pairs="keep_a:dev_a,keep_b:dev_b" -f - 2>&1 | sed 's/^/  scope: /'

FAILED=0
check() {
  local got
  got="$(psql_on "$DB" -c "$2")"
  if [ "$got" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: got [$got], want [$3]"; FAILED=1; fi
}
check "only the allowed accounts, in dev ids" "SELECT string_agg(id, ',' ORDER BY id) FROM users" "dev_a,dev_b"
check "only their characters" "SELECT string_agg(name, ',' ORDER BY name) FROM characters" "Pellmoor,Thornwick"
check "the other account's party is gone" "SELECT count(*) FROM party" "1"
check "its seat in ours stays, unbound" \
  "SELECT coalesce(linked_character_id::text, 'none') FROM party_member WHERE name = 'Quillon'" "none"
check "a people link to it is unbound, ours to each other kept" \
  "SELECT string_agg(name || '=' || coalesce(linked_user_id, 'none'), ',' ORDER BY name) FROM person" \
  "Pellmoor=dev_b,Quillon=none"
check "a drop it logged in our pool stays, logged by nobody" \
  "SELECT count(*) || ':' || coalesce(max(recorded_by_user_id), 'none') FROM party_loot" "1:none"
check "its notifications and friend requests are gone" \
  "SELECT (SELECT count(*) FROM notification) + (SELECT count(*) FROM friend_request)" "0"
check "no text anywhere still names it or a prod id" "SELECT count(*) FROM (
  SELECT 1 FROM characters WHERE user_id IN ('other_c','keep_a','keep_b')
  UNION ALL SELECT 1 FROM person WHERE linked_user_id IN ('other_c','keep_a','keep_b')
  UNION ALL SELECT 1 FROM party WHERE user_id IN ('other_c','keep_a','keep_b')) x" "0"
check "catalog references moved onto dev's ids" "SELECT count(*) FROM party p
  WHERE NOT EXISTS (SELECT 1 FROM sync_dev_catalog d WHERE d.kind = 'boss_catalog' AND d.id = p.boss_catalog_id::text)" "0"

exit "$FAILED"
