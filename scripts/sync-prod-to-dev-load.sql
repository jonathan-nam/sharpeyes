-- Replace the allowed dev accounts' data with the scoped copy of prod, in ONE transaction: if any
-- check below fails, dev is left exactly as it was. Runs in the DEV database.
--
--   :pairs  prod-id:dev-id,...  (only the dev ids are used here)
--
-- psql runs inside the postgres container, so nothing here can name a host file. The script streams
-- this file with sync-prod-to-dev-sweep.sql ahead of it, and splices in at the two markers below:
-- the copy's per-table row counts, then the copy itself and each account's settings.

\set ON_ERROR_STOP on

\o /dev/null
SELECT set_config('sync.pairs', :'pairs', false);
\o

BEGIN;
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE sync_dev_ids AS
SELECT split_part(pair, ':', 2) AS id
FROM unnest(string_to_array(current_setting('sync.pairs'), ',')) AS pair;

CREATE TEMP TABLE sync_expected (tbl TEXT PRIMARY KEY, n BIGINT);
-- @expected

-- Every row these accounts own, through each foreign key to users that owns its row (anything but
-- SET NULL, which only names somebody), then whatever hung off those. Their users and sign-in rows
-- stay, so the browser stays signed in. Other dev accounts lose only what a real delete would take
-- from them: a seat or link that named these accounts' rows.
DO $$
DECLARE
    fk      RECORD;
    removed BIGINT := 0;
    n       BIGINT;
BEGIN
    IF EXISTS (SELECT 1 FROM sync_dev_ids d WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = d.id)) THEN
        RAISE EXCEPTION 'a dev account has never signed in, so it has no users row: %',
            (SELECT string_agg(id, ', ') FROM sync_dev_ids d WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = d.id));
    END IF;
    UPDATE users SET main_character_id = NULL WHERE id IN (SELECT id FROM sync_dev_ids);
    FOR fk IN
        SELECT c.conrelid::regclass AS child, a.attname::TEXT AS col
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND c.confdeltype <> 'n'
    LOOP
        EXECUTE format('DELETE FROM %s WHERE %I IN (SELECT id FROM sync_dev_ids)', fk.child, fk.col);
        GET DIAGNOSTICS n = ROW_COUNT;
        removed := removed + n;
    END LOOP;
    RAISE NOTICE 'cleared % rows the dev accounts owned, and % that hung off them',
        removed, pg_temp.sweep_orphans(true);
END $$;

-- Prod wins: a dev row with the same key as one in the copy, whoever holds it (an older copy of the
-- same prod data, usually), is deleted here so the copy's row can land.
-- @collisions
DO $$
BEGIN
    RAISE NOTICE 'and % rows that hung off rows the copy replaces', pg_temp.sweep_orphans(true);
END $$;

CREATE TEMP TABLE sync_before AS SELECT tbl, 0::BIGINT AS n FROM sync_expected;
DO $$
DECLARE r RECORD; rows_now BIGINT;
BEGIN
    FOR r IN SELECT tbl FROM sync_before LOOP
        EXECUTE format('SELECT count(*) FROM %I', r.tbl) INTO rows_now;
        UPDATE sync_before SET n = rows_now WHERE tbl = r.tbl;
    END LOOP;
END $$;

-- @data
-- pg_dump's preamble empties the search path. Everything below names public tables unqualified.
SET search_path = public;

-- Verify by sum: what each table gained is exactly what the copy holds. A COPY is all or nothing, so
-- a mismatch here means the dump and the counts disagree, and that is not a load to keep.
DO $$
DECLARE r RECORD; n BIGINT; orphans BIGINT;
BEGIN
    FOR r IN SELECT e.tbl, e.n AS expected, b.n AS before FROM sync_expected e JOIN sync_before b USING (tbl) LOOP
        EXECUTE format('SELECT count(*) FROM %I', r.tbl) INTO n;
        IF n - r.before <> r.expected THEN
            RAISE EXCEPTION '% gained % rows, the copy holds %', r.tbl, n - r.before, r.expected;
        END IF;
    END LOOP;
    -- Foreign keys were off for the load. Every one has to hold again before this commits.
    orphans := pg_temp.sweep_orphans(false);
    IF orphans > 0 THEN
        RAISE EXCEPTION '% rows name a parent that is not there (listed above)', orphans;
    END IF;
END $$;

COMMIT;
