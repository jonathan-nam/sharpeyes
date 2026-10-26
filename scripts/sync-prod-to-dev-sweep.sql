-- pg_temp.sweep_orphans(apply): every row whose foreign key names a parent that is gone.
--
-- With apply, each one is dealt with as its own ON DELETE rule says (delete, or set null), again and
-- again until a pass changes nothing, which is what a real cascade would have done. Without it, they
-- are only counted, so a load can prove it left none.
--
-- Read from the CATALOG, like reassign-user.sql: a hand-written list is one a future table falls off.
-- Needed because the sync runs with session_replication_role = replica, which switches every foreign
-- key off, and this is what puts them back. Session-scoped (pg_temp), so it leaves nothing behind.

CREATE FUNCTION pg_temp.sweep_orphans(apply BOOLEAN) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
    fk     RECORD;
    orphan TEXT;
    n      BIGINT;
    pass   BIGINT;
    total  BIGINT := 0;
BEGIN
    LOOP
        pass := 0;
        FOR fk IN
            SELECT c.conrelid::regclass AS child,
                   c.confrelid::regclass AS parent,
                   c.confdeltype AS rule,
                   array_agg(ca.attname::TEXT ORDER BY k.ord) AS child_cols,
                   array_agg(pa.attname::TEXT ORDER BY k.ord) AS parent_cols
            FROM pg_constraint c
            CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(child_att, parent_att, ord)
            JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.child_att
            JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.parent_att
            WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
            GROUP BY c.oid, c.conrelid, c.confrelid, c.confdeltype
        LOOP
            -- Every key column set, and no parent row with those values: a NULL key names nothing.
            SELECT string_agg(format('t.%I IS NOT NULL', col), ' AND ')
                || format(' AND NOT EXISTS (SELECT 1 FROM %s p WHERE ', fk.parent)
                || string_agg(format('p.%I = t.%I', fk.parent_cols[i], col), ' AND ')
                || ')'
            INTO orphan
            FROM unnest(fk.child_cols) WITH ORDINALITY AS u(col, i);

            IF NOT apply THEN
                EXECUTE format('SELECT count(*) FROM %s t WHERE %s', fk.child, orphan) INTO n;
                IF n > 0 THEN
                    RAISE NOTICE '  % rows of % name a missing %', n, fk.child, fk.parent;
                END IF;
            ELSIF fk.rule = 'n' THEN
                EXECUTE format(
                    'UPDATE %s t SET %s WHERE %s',
                    fk.child,
                    (SELECT string_agg(format('%I = NULL', col), ', ') FROM unnest(fk.child_cols) AS col),
                    orphan
                );
                GET DIAGNOSTICS n = ROW_COUNT;
            ELSIF fk.rule = 'd' THEN
                RAISE EXCEPTION '% uses ON DELETE SET DEFAULT, which this does not handle', fk.child;
            ELSE
                EXECUTE format('DELETE FROM %s t WHERE %s', fk.child, orphan);
                GET DIAGNOSTICS n = ROW_COUNT;
            END IF;
            pass := pass + n;
        END LOOP;
        total := total + pass;
        EXIT WHEN pass = 0 OR NOT apply;
    END LOOP;
    RETURN total;
END $$;
