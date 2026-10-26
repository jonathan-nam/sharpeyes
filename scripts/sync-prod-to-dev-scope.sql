-- Cut a scratch copy of prod down to the allowed accounts, in their dev ids, against dev's catalog.
-- Runs in the SCRATCH database only; sync-prod-to-dev.sh creates it and drops it after.
--
--   :pairs  prod-id:dev-id,prod-id:dev-id   (the allowlist, from SYNC_ACCOUNTS)
--
-- Expects sync_dev_catalog(kind, key, id), dev's own catalog rows, loaded by the script first, and
-- sync-prod-to-dev-sweep.sql streamed ahead of it.

\set ON_ERROR_STOP on

\o /dev/null
SELECT set_config('sync.pairs', :'pairs', false);
\o

SET session_replication_role = replica;
BEGIN;

CREATE TEMP TABLE sync_pair AS
SELECT split_part(pair, ':', 1) AS prod_id, split_part(pair, ':', 2) AS dev_id
FROM unnest(string_to_array(current_setting('sync.pairs'), ',')) AS pair;

DO $$
DECLARE
    removed BIGINT;
    swept   BIGINT;
    col     RECORD;
    pair    RECORD;
BEGIN
    IF EXISTS (SELECT 1 FROM sync_pair p WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.prod_id)) THEN
        RAISE EXCEPTION 'an allowed prod account is not in prod: %',
            (SELECT string_agg(prod_id, ', ') FROM sync_pair p WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.prod_id));
    END IF;

    -- Everybody else, and then whatever hung off them, each foreign key's own rule deciding: their
    -- rows go, and a seat or link of ours that named them is unbound rather than kept pointing at
    -- somebody who is not here. Nothing of another account survives this.
    DELETE FROM users WHERE id NOT IN (SELECT prod_id FROM sync_pair);
    GET DIAGNOSTICS removed = ROW_COUNT;
    swept := pg_temp.sweep_orphans(true);
    RAISE NOTICE 'removed % other accounts and % rows that were theirs or named them', removed, swept;

    -- Prod ids to dev ids, in every text and json column, foreign key or not: notification and
    -- invite payloads carry ids inside them. Only the allowed accounts are left to carry any.
    FOR pair IN SELECT * FROM sync_pair LOOP
        FOR col IN
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND data_type IN ('text', 'character varying', 'jsonb', 'json')
              AND table_name NOT IN ('flyway_schema_history', 'sync_dev_catalog')
        LOOP
            EXECUTE format(
                'UPDATE %I SET %I = replace(%I::text, $1, $2)::%s WHERE strpos(%I::text, $1) > 0',
                col.table_name, col.column_name, col.column_name,
                CASE col.data_type WHEN 'character varying' THEN 'varchar' ELSE col.data_type END,
                col.column_name
            ) USING pair.prod_id, pair.dev_id;
        END LOOP;
    END LOOP;
END $$;

-- Catalog rows are seeded per database, and the ids differ, so every reference to one is moved onto
-- dev's row for the same key. A key dev does not have is refused: the row would point at nothing.
CREATE TEMP TABLE sync_catalog_key (catalog TEXT, key_col TEXT);
INSERT INTO sync_catalog_key VALUES
    ('boss_catalog', 'boss_key'), ('drop_catalog', 'drop_key'), ('token_catalog', 'name');

DO $$
DECLARE
    fk      RECORD;
    missing TEXT;
BEGIN
    FOR fk IN
        SELECT c.conrelid::regclass::TEXT AS child, a.attname::TEXT AS col, k.catalog, k.key_col
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        JOIN sync_catalog_key k ON k.catalog = c.confrelid::regclass::TEXT
        WHERE c.contype = 'f'
          AND c.conrelid::regclass::TEXT NOT IN (SELECT catalog FROM sync_catalog_key)
          AND c.conrelid::regclass::TEXT NOT IN ('boss_drop', 'boss_drop_amount', 'redemption_rule', 'token_clear_amount')
    LOOP
        EXECUTE format(
            'SELECT string_agg(DISTINCT p.%I, '', '') FROM %I t JOIN %I p ON p.id = t.%I
             WHERE NOT EXISTS (SELECT 1 FROM sync_dev_catalog d WHERE d.kind = $1 AND d.key = p.%I)',
            fk.key_col, fk.child, fk.catalog, fk.col, fk.key_col
        ) INTO missing USING fk.catalog;
        IF missing IS NOT NULL THEN
            RAISE EXCEPTION '%.% names % rows dev does not have: %. Start the dev backend on master to reseed them.',
                fk.child, fk.col, fk.catalog, missing;
        END IF;
        EXECUTE format(
            'UPDATE %I t SET %I = d.id::uuid FROM %I p JOIN sync_dev_catalog d ON d.kind = $1 AND d.key = p.%I
             WHERE p.id = t.%I',
            fk.child, fk.col, fk.catalog, fk.key_col, fk.col
        ) USING fk.catalog;
    END LOOP;
END $$;

COMMIT;
