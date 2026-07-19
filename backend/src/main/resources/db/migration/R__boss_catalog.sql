-- GENERATED FROM catalog/bosses.yaml. DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__): editing bosses.yaml reseeds boss_catalog on the next boot. Upserts by
-- boss_key and keeps an existing row's id, which boss_clear references, so it is never churned.

INSERT INTO boss_catalog (id, boss_key, name, reset, sort_order)
SELECT COALESCE(existing.id, gen_random_uuid()), v.boss_key, v.name, v.reset, v.sort_order
FROM (VALUES
    ('lotus', 'Lotus', 'WEEKLY', 0),
    ('damien', 'Damien', 'WEEKLY', 1),
    ('guardian-angel-slime', 'Guardian Angel Slime', 'WEEKLY', 2),
    ('lucid', 'Lucid', 'WEEKLY', 3),
    ('will', 'Will', 'WEEKLY', 4),
    ('gloom', 'Gloom', 'WEEKLY', 5),
    ('verus-hilla', 'Verus Hilla', 'WEEKLY', 6),
    ('darknell', 'Darknell', 'WEEKLY', 7),
    ('chosen-seren', 'Chosen Seren', 'WEEKLY', 8),
    ('kalos-the-guardian', 'Kalos the Guardian', 'WEEKLY', 9),
    ('first-adversary', 'First Adversary', 'WEEKLY', 10),
    ('kaling', 'Kaling', 'WEEKLY', 11),
    ('malefic-star', 'Malefic Star', 'WEEKLY', 12),
    ('limbo', 'Limbo', 'WEEKLY', 13),
    ('baldrix', 'Baldrix', 'WEEKLY', 14),
    ('black-mage', 'Black Mage', 'MONTHLY', 15)
) AS v (boss_key, name, reset, sort_order)
LEFT JOIN boss_catalog existing ON existing.boss_key = v.boss_key
ON CONFLICT (boss_key) DO UPDATE SET
    name       = EXCLUDED.name,
    reset      = EXCLUDED.reset,
    sort_order = EXCLUDED.sort_order;

-- Then remove what the manifest no longer lists. The manifest is the whole truth: without this
-- the seed can only ADD, so a boss deleted here survives in any database that already had it,
-- and an older image redeploying re-inserts one this seed just dropped.
--
-- DESTRUCTIVE, and deliberately so: this deletes every recorded clear for a removed boss, for
-- every user, with no migration to review first. A mistyped or renamed key is therefore silent
-- data loss, which is why bosses.yaml calls a key permanent. The NOTICE puts what went into the
-- boot log, so the deletion is at least never invisible.
DO $$
DECLARE gone text;
BEGIN
    SELECT string_agg(boss_key, ', ' ORDER BY boss_key) INTO gone
    FROM boss_catalog WHERE boss_key NOT IN ('lotus', 'damien', 'guardian-angel-slime', 'lucid', 'will', 'gloom', 'verus-hilla', 'darknell', 'chosen-seren', 'kalos-the-guardian', 'first-adversary', 'kaling', 'malefic-star', 'limbo', 'baldrix', 'black-mage');

    IF gone IS NOT NULL THEN
        RAISE NOTICE 'boss_catalog: dropping % and every clear recorded against them (not in catalog/bosses.yaml)', gone;
    END IF;
END $$;

DELETE FROM boss_clear
WHERE boss_catalog_id IN (SELECT id FROM boss_catalog WHERE boss_key NOT IN ('lotus', 'damien', 'guardian-angel-slime', 'lucid', 'will', 'gloom', 'verus-hilla', 'darknell', 'chosen-seren', 'kalos-the-guardian', 'first-adversary', 'kaling', 'malefic-star', 'limbo', 'baldrix', 'black-mage'));

DELETE FROM boss_catalog WHERE boss_key NOT IN ('lotus', 'damien', 'guardian-angel-slime', 'lucid', 'will', 'gloom', 'verus-hilla', 'darknell', 'chosen-seren', 'kalos-the-guardian', 'first-adversary', 'kaling', 'malefic-star', 'limbo', 'baldrix', 'black-mage');
