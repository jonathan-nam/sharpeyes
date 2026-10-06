-- GENERATED FROM catalog/drops.yaml. DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__): editing drops.yaml reseeds the drop catalog on the next boot. drop_catalog
-- upserts by drop_key and keeps an existing row's id, which party_loot references. boss_drop is
-- rebuilt outright, so a drop removed from a boss's table really leaves it.

INSERT INTO drop_catalog (id, drop_key, name, icon_ref_key, per_member, worlds, quantity, fungible, untradeable, sort_order)
SELECT COALESCE(existing.id, gen_random_uuid()), v.drop_key, v.name, v.icon_ref_key, v.per_member,
       v.worlds, v.quantity, v.fungible, v.untradeable, v.sort_order
FROM (VALUES
    ('whisper-of-the-source', 'Whisper of the Source', 'whisper-of-the-source.png', NULL, NULL, 1, FALSE, FALSE, 0),
    ('oath-of-death', 'Oath of Death', 'oath-of-death.png', NULL, NULL, 1, FALSE, FALSE, 1),
    ('immortal-legacy', 'Immortal Legacy', 'immortal-legacy.png', NULL, NULL, 1, FALSE, FALSE, 2),
    ('blissful-nightmare', 'Blissful Nightmare', 'blissful-nightmare.png', NULL, NULL, 1, FALSE, FALSE, 3),
    ('original-sin-of-pride', 'Original Sin of Pride', 'original-sin-of-pride.png', NULL, NULL, 1, FALSE, FALSE, 4),
    ('genesis-badge', 'Genesis Badge', 'genesis-badge.png', NULL, NULL, 1, FALSE, FALSE, 5),
    ('exceptional-hammer-belt', 'Exceptional Hammer (Belt)', 'exceptional-hammer-belt.png', NULL, NULL, 1, FALSE, FALSE, 6),
    ('exceptional-hammer-face', 'Exceptional Hammer (Face Acc)', 'exceptional-hammer-face.png', NULL, NULL, 1, FALSE, FALSE, 7),
    ('exceptional-hammer-eye', 'Exceptional Hammer (Eye Acc)', 'exceptional-hammer-eye.png', NULL, NULL, 1, FALSE, FALSE, 8),
    ('exceptional-hammer-earrings', 'Exceptional Hammer (Earrings)', 'exceptional-hammer-earrings.png', NULL, NULL, 1, FALSE, FALSE, 9),
    ('exceptional-hammer-medal', 'Exceptional Hammer (Medal)', 'exceptional-hammer-medal.png', NULL, NULL, 1, FALSE, FALSE, 10),
    ('grindstone-of-faith', 'Grindstone of Faith', 'grindstone-of-faith.png', NULL, NULL, 1, TRUE, FALSE, 11),
    ('grindstone-of-life', 'Grindstone of Life', 'grindstone-of-life.png', NULL, NULL, 1, TRUE, FALSE, 12),
    ('eternal-armor-of-desire-box', 'Eternal Armor of Desire Box', 'eternal-armor-of-desire-box.png', NULL, NULL, 1, TRUE, FALSE, 13),
    ('divine-eternal-armor-box', 'Divine Eternal Armor Box', 'divine-eternal-armor-box.png', NULL, NULL, 1, TRUE, FALSE, 14),
    ('ferocious-beast-eternal-armor-box', 'Ferocious Beast Eternal Armor Box', 'ferocious-beast-eternal-armor-box.png', NULL, NULL, 1, TRUE, FALSE, 15),
    ('ancient-eternal-armor-box', 'Ancient Eternal Armor Box', 'ancient-eternal-armor-box.png', NULL, NULL, 1, TRUE, FALSE, 16),
    ('eternal-armor-of-oaths-box', 'Eternal Armor of Oaths Box', 'eternal-armor-of-oaths-box.png', NULL, NULL, 1, TRUE, FALSE, 17),
    ('eternal-armor-of-radiance-box', 'Eternal Armor of Radiance Box', 'eternal-armor-of-radiance-box.png', NULL, NULL, 1, TRUE, FALSE, 18),
    ('eternal-twisted-armor-box', 'Eternal Twisted Armor Box', 'eternal-twisted-armor-box.png', NULL, NULL, 1, TRUE, FALSE, 19),
    ('mitras-rage-selection-box', 'Mitra''s Rage Selection Box', 'mitras-rage-selection-box.png', NULL, NULL, 1, FALSE, FALSE, 20),
    ('ring-of-restraint-4', 'Ring of Restraint Lv. 4', 'ring-of-restraint-4.png', 'HEROIC', NULL, 1, FALSE, FALSE, 21),
    ('continuous-ring-4', 'Continuous Ring Lv. 4', 'continuous-ring-4.png', 'HEROIC', NULL, 1, FALSE, FALSE, 22),
    ('vestige-of-erion', 'Vestige of Erion Coupon', 'vestige-of-erion.png', 'HEROIC', NULL, 1, FALSE, FALSE, 23)
) AS v (drop_key, name, icon_ref_key, per_member, worlds, quantity, fungible, untradeable, sort_order)
LEFT JOIN drop_catalog existing ON existing.drop_key = v.drop_key
ON CONFLICT (drop_key) DO UPDATE SET
    name         = EXCLUDED.name,
    icon_ref_key = EXCLUDED.icon_ref_key,
    per_member = EXCLUDED.per_member,
    worlds     = EXCLUDED.worlds,
    quantity   = EXCLUDED.quantity,
    fungible   = EXCLUDED.fungible,
    untradeable = EXCLUDED.untradeable,
    sort_order = EXCLUDED.sort_order;

DELETE FROM boss_drop;
DELETE FROM boss_drop_amount;

INSERT INTO boss_drop (boss_catalog_id, drop_catalog_id, sort_order)
SELECT b.id, d.id, v.sort_order
FROM (VALUES
    ('limbo', 'whisper-of-the-source', 0),
    ('limbo', 'grindstone-of-life', 1),
    ('limbo', 'grindstone-of-faith', 2),
    ('limbo', 'eternal-armor-of-desire-box', 3),
    ('limbo', 'ring-of-restraint-4', 4),
    ('limbo', 'continuous-ring-4', 5),
    ('limbo', 'vestige-of-erion', 6),
    ('chosen-seren', 'exceptional-hammer-face', 0),
    ('chosen-seren', 'mitras-rage-selection-box', 1),
    ('chosen-seren', 'ring-of-restraint-4', 2),
    ('chosen-seren', 'continuous-ring-4', 3),
    ('chosen-seren', 'vestige-of-erion', 4),
    ('kalos-the-guardian', 'exceptional-hammer-eye', 0),
    ('kalos-the-guardian', 'grindstone-of-life', 1),
    ('kalos-the-guardian', 'divine-eternal-armor-box', 2),
    ('kalos-the-guardian', 'ring-of-restraint-4', 3),
    ('kalos-the-guardian', 'continuous-ring-4', 4),
    ('kalos-the-guardian', 'vestige-of-erion', 5),
    ('kaling', 'exceptional-hammer-earrings', 0),
    ('kaling', 'grindstone-of-life', 1),
    ('kaling', 'grindstone-of-faith', 2),
    ('kaling', 'ferocious-beast-eternal-armor-box', 3),
    ('kaling', 'ring-of-restraint-4', 4),
    ('kaling', 'continuous-ring-4', 5),
    ('kaling', 'vestige-of-erion', 6),
    ('first-adversary', 'immortal-legacy', 0),
    ('first-adversary', 'exceptional-hammer-medal', 1),
    ('first-adversary', 'grindstone-of-life', 2),
    ('first-adversary', 'ancient-eternal-armor-box', 3),
    ('first-adversary', 'ring-of-restraint-4', 4),
    ('first-adversary', 'continuous-ring-4', 5),
    ('first-adversary', 'vestige-of-erion', 6),
    ('malefic-star', 'blissful-nightmare', 0),
    ('malefic-star', 'grindstone-of-life', 1),
    ('malefic-star', 'grindstone-of-faith', 2),
    ('malefic-star', 'eternal-armor-of-radiance-box', 3),
    ('malefic-star', 'ring-of-restraint-4', 4),
    ('malefic-star', 'continuous-ring-4', 5),
    ('malefic-star', 'vestige-of-erion', 6),
    ('jupiter', 'original-sin-of-pride', 0),
    ('jupiter', 'grindstone-of-life', 1),
    ('jupiter', 'grindstone-of-faith', 2),
    ('jupiter', 'eternal-twisted-armor-box', 3),
    ('jupiter', 'ring-of-restraint-4', 4),
    ('jupiter', 'continuous-ring-4', 5),
    ('jupiter', 'vestige-of-erion', 6),
    ('baldrix', 'oath-of-death', 0),
    ('baldrix', 'grindstone-of-life', 1),
    ('baldrix', 'grindstone-of-faith', 2),
    ('baldrix', 'eternal-armor-of-oaths-box', 3),
    ('baldrix', 'ring-of-restraint-4', 4),
    ('baldrix', 'continuous-ring-4', 5),
    ('baldrix', 'vestige-of-erion', 6),
    ('black-mage', 'genesis-badge', 0),
    ('black-mage', 'exceptional-hammer-belt', 1),
    ('black-mage', 'ring-of-restraint-4', 2),
    ('black-mage', 'continuous-ring-4', 3)
) AS v (boss_key, drop_key, sort_order)
JOIN boss_catalog b ON b.boss_key = v.boss_key
JOIN drop_catalog d ON d.drop_key = v.drop_key;

INSERT INTO boss_drop_amount (boss_catalog_id, drop_catalog_id, difficulty, world, pieces, bundles)
SELECT b.id, d.id, v.difficulty, v.world, v.pieces, v.bundles
FROM (VALUES
    ('limbo', 'vestige-of-erion', 'HARD', 'INTERACTIVE', 60, 3),
    ('chosen-seren', 'vestige-of-erion', 'EXTREME', 'INTERACTIVE', 30, 6),
    ('kalos-the-guardian', 'vestige-of-erion', 'EXTREME', 'INTERACTIVE', 180, 6),
    ('kaling', 'vestige-of-erion', 'HARD', 'INTERACTIVE', 60, 6),
    ('kaling', 'vestige-of-erion', 'EXTREME', 'INTERACTIVE', 480, 6),
    ('first-adversary', 'vestige-of-erion', 'HARD', 'INTERACTIVE', 30, 3),
    ('first-adversary', 'vestige-of-erion', 'EXTREME', 'INTERACTIVE', 240, 3),
    ('malefic-star', 'vestige-of-erion', 'HARD', 'INTERACTIVE', 90, 3),
    ('jupiter', 'vestige-of-erion', 'NORMAL', 'INTERACTIVE', 45, 3),
    ('jupiter', 'vestige-of-erion', 'HARD', 'INTERACTIVE', 360, 3),
    ('baldrix', 'vestige-of-erion', 'HARD', 'INTERACTIVE', 120, 3)
) AS v (boss_key, drop_key, difficulty, world, pieces, bundles)
JOIN boss_catalog b ON b.boss_key = v.boss_key
JOIN drop_catalog d ON d.drop_key = v.drop_key;
