-- GENERATED FROM catalog/items.yaml. DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__) on purpose: Flyway re-applies it whenever its checksum changes, so
-- adding an item to the manifest reseeds the catalog on the next boot. A versioned
-- migration is immutable once applied and is the wrong tool for a seed that evolves.
--
-- Upserts rather than replaces: token_catalog.id is referenced by character_token_count,
-- so deleting and reinserting would take every user's counts with it.

INSERT INTO token_catalog (id, vision_key, name, source_boss_name, icon_ref_key, item_group, sort_order)
SELECT
    COALESCE(existing.id, gen_random_uuid()),
    v.vision_key, v.name, v.boss, v.icon, v.item_group, v.sort_order
FROM (VALUES
    ('blissful-fantasy-shard', 'Blissful Fantasy Shard', 'Malefic Star', 'blissful-fantasy-shard.png', 'Eternal Pieces', 13),
    ('distorted-ambition', 'Distorted Ambition', 'Limbo', 'distorted-ambition.png', 'Eternal Pieces', 14),
    ('echo-ancient-resolve', 'Echo of Ancient Resolve', 'First Adversary', 'echo-ancient-resolve.png', 'Eternal Pieces', 12),
    ('ferocious-beast-ring', 'Ferocious Beast Entanglement Ring', 'Kaling', 'ferocious-beast-ring.png', 'Eternal Pieces', 11),
    ('kalos-token', 'Kalos''s Residual Determination', 'Kalos the Guardian', 'kalos-token.png', 'Eternal Pieces', 10),
    ('trace-eternal-loyalty', 'Trace of Eternal Loyalty', 'Baldrix', 'trace-eternal-loyalty.png', 'Eternal Pieces', 15),
    ('lingering-twisted-desire', 'Lingering Twisted Desire', 'Jupiter', 'lingering-twisted-desire.png', 'Eternal Pieces', 16),
    ('kalos-residual-determination-fragment', 'Kalos''s Residual Determination Fragment', 'Kalos the Guardian', 'kalos-residual-determination-fragment.png', 'Eternal Pieces', 17),
    ('ferocious-entanglement-ring-fragment', 'Ferocious Entanglement Ring Fragment', 'Kaling', 'ferocious-entanglement-ring-fragment.png', 'Eternal Pieces', 18),
    ('whisper-ancient-resolve', 'Whisper of Ancient Resolve', 'First Adversary', 'whisper-ancient-resolve.png', 'Eternal Pieces', 19),
    ('blissful-fantasy-fragment', 'Blissful Fantasy Fragment', 'Malefic Star', 'blissful-fantasy-fragment.png', 'Eternal Pieces', 20),
    ('sayram-elixir', 'Sayram''s Elixir', 'The Collector', 'sayram-elixir.png', 'Consumables', 40),
    ('aurelia-elixir', 'Aurelia''s Elixir', 'The Collector', 'aurelia-elixir.png', 'Consumables', 41),
    ('honorable-elixir', 'Honorable Elixir', 'The Collector', 'honorable-elixir.png', 'Consumables', 42),
    ('collector-elixir', 'Collector''s Elixir', 'The Collector', 'collector-elixir.png', 'Consumables', 43),
    ('extreme-red-potion', 'Extreme Red Potion', 'Monster Park', 'extreme-red-potion.png', 'Consumables', 50),
    ('extreme-blue-potion', 'Extreme Blue Potion', 'Monster Park', 'extreme-blue-potion.png', 'Consumables', 51),
    ('extreme-green-potion', 'Extreme Green Potion', 'Monster Park', 'extreme-green-potion.png', 'Consumables', 52),
    ('arcane-vanishing-journey', 'Arcane Symbol: Vanishing Journey Coupon', 'Daily', 'arcane-vanishing-journey.png', 'Symbols', 20),
    ('arcane-chu-chu-island', 'Arcane Symbol: Chu Chu Island Coupon', 'Daily', 'arcane-chu-chu-island.png', 'Symbols', 21),
    ('arcane-lachelein', 'Arcane Symbol: Lachelein Coupon', 'Daily', 'arcane-lachelein.png', 'Symbols', 22),
    ('arcane-arcana', 'Arcane Symbol: Arcana Coupon', 'Daily', 'arcane-arcana.png', 'Symbols', 23),
    ('arcane-morass', 'Arcane Symbol: Morass Coupon', 'Daily', 'arcane-morass.png', 'Symbols', 24),
    ('arcane-esfera', 'Arcane Symbol: Esfera Coupon', 'Daily', 'arcane-esfera.png', 'Symbols', 25),
    ('sacred-cernium', 'Sacred Symbol: Cernium Coupon', 'Daily', 'sacred-cernium.png', 'Symbols', 30),
    ('sacred-hotel-arcus', 'Sacred Symbol: Hotel Arcus Coupon', 'Daily', 'sacred-hotel-arcus.png', 'Symbols', 31),
    ('sacred-odium', 'Sacred Symbol: Odium Coupon', 'Daily', 'sacred-odium.png', 'Symbols', 32),
    ('sacred-shangri-la', 'Sacred Symbol: Shangri-La Coupon', 'Daily', 'sacred-shangri-la.png', 'Symbols', 33),
    ('sacred-arteria', 'Sacred Symbol: Arteria Coupon', 'Daily', 'sacred-arteria.png', 'Symbols', 34),
    ('sacred-carcion', 'Sacred Symbol: Carcion Coupon', 'Daily', 'sacred-carcion.png', 'Symbols', 35),
    ('sacred-tallahart', 'Sacred Symbol: Tallahart Coupon', 'Daily', 'sacred-tallahart.png', 'Symbols', 36)
) AS v (vision_key, name, boss, icon, item_group, sort_order)
LEFT JOIN token_catalog existing ON existing.vision_key = v.vision_key
ON CONFLICT (vision_key) DO UPDATE SET
    name             = EXCLUDED.name,
    source_boss_name = EXCLUDED.source_boss_name,
    icon_ref_key     = EXCLUDED.icon_ref_key,
    item_group       = EXCLUDED.item_group,
    sort_order       = EXCLUDED.sort_order;

-- An item is redeemable if a rule exists for it. There is no flag to keep in step with
-- the fields it governs. So a manifest entry that stops being a REDEMPTION_TOKEN must have
-- its rule removed, not merely have its threshold nulled.
DELETE FROM redemption_rule
WHERE item_id IN (
    SELECT id FROM token_catalog
    WHERE vision_key NOT IN ('blissful-fantasy-shard', 'distorted-ambition', 'echo-ancient-resolve', 'ferocious-beast-ring', 'kalos-token', 'trace-eternal-loyalty', 'lingering-twisted-desire', 'kalos-residual-determination-fragment', 'ferocious-entanglement-ring-fragment', 'whisper-ancient-resolve', 'blissful-fantasy-fragment')
);

INSERT INTO redemption_rule (item_id, redeem_threshold, slot_group)
SELECT c.id, v.redeem_threshold, v.slot_group
FROM (VALUES
    ('blissful-fantasy-shard', 10, ARRAY['Hat', 'Top', 'Bottom', 'Shoulder']::TEXT[]),
    ('distorted-ambition', 10, ARRAY['Cape', 'Glove', 'Shoe']::TEXT[]),
    ('echo-ancient-resolve', 10, ARRAY['Hat', 'Top', 'Bottom', 'Shoulder']::TEXT[]),
    ('ferocious-beast-ring', 10, ARRAY['Hat', 'Top', 'Bottom', 'Shoulder']::TEXT[]),
    ('kalos-token', 10, ARRAY['Hat', 'Top', 'Bottom', 'Shoulder']::TEXT[]),
    ('trace-eternal-loyalty', 10, ARRAY['Cape', 'Glove', 'Shoe']::TEXT[]),
    ('lingering-twisted-desire', 10, ARRAY['Cape', 'Glove', 'Shoe']::TEXT[]),
    ('kalos-residual-determination-fragment', 20, ARRAY['Hat', 'Top', 'Bottom', 'Shoulder']::TEXT[]),
    ('ferocious-entanglement-ring-fragment', 20, ARRAY['Hat', 'Top', 'Bottom', 'Shoulder']::TEXT[]),
    ('whisper-ancient-resolve', 20, ARRAY['Hat', 'Top', 'Bottom', 'Shoulder']::TEXT[]),
    ('blissful-fantasy-fragment', 20, ARRAY['Hat', 'Top', 'Bottom', 'Shoulder']::TEXT[])
) AS v (vision_key, redeem_threshold, slot_group)
JOIN token_catalog c ON c.vision_key = v.vision_key
ON CONFLICT (item_id) DO UPDATE SET
    redeem_threshold = EXCLUDED.redeem_threshold,
    slot_group       = EXCLUDED.slot_group;

-- What one clear puts in one character's inventory. Rebuilt outright: nothing references it, and a
-- count taken out of the manifest has to actually leave. A zero row is a mode that drops none.
DELETE FROM token_clear_amount;

INSERT INTO token_clear_amount (boss_catalog_id, difficulty, world, token_catalog_id, quantity, stack_size, pooled)
SELECT b.id, v.difficulty, v.world, t.id, v.quantity, v.stack_size, v.pooled
FROM (VALUES
    ('malefic-star', 'HARD', 'INTERACTIVE', 'blissful-fantasy-shard', 18, 3, TRUE),
    ('malefic-star', 'HARD', 'HEROIC', 'blissful-fantasy-shard', 2, 1, FALSE),
    ('limbo', 'NORMAL', 'INTERACTIVE', 'distorted-ambition', 1, 1, FALSE),
    ('limbo', 'NORMAL', 'HEROIC', 'distorted-ambition', 1, 1, FALSE),
    ('limbo', 'HARD', 'INTERACTIVE', 'distorted-ambition', 2, 1, FALSE),
    ('limbo', 'HARD', 'HEROIC', 'distorted-ambition', 2, 1, FALSE),
    ('first-adversary', 'EASY', 'INTERACTIVE', 'echo-ancient-resolve', 0, 1, TRUE),
    ('first-adversary', 'EASY', 'HEROIC', 'echo-ancient-resolve', 0, 1, FALSE),
    ('first-adversary', 'HARD', 'INTERACTIVE', 'echo-ancient-resolve', 6, 1, TRUE),
    ('first-adversary', 'HARD', 'HEROIC', 'echo-ancient-resolve', 2, 1, FALSE),
    ('first-adversary', 'EXTREME', 'INTERACTIVE', 'echo-ancient-resolve', 16, 1, TRUE),
    ('first-adversary', 'EXTREME', 'HEROIC', 'echo-ancient-resolve', 3, 1, FALSE),
    ('kaling', 'HARD', 'INTERACTIVE', 'ferocious-beast-ring', 7, 1, TRUE),
    ('kaling', 'HARD', 'HEROIC', 'ferocious-beast-ring', 2, 1, FALSE),
    ('kaling', 'EXTREME', 'INTERACTIVE', 'ferocious-beast-ring', 18, 1, TRUE),
    ('kaling', 'EXTREME', 'HEROIC', 'ferocious-beast-ring', 3, 1, FALSE),
    ('kalos-the-guardian', 'EASY', 'INTERACTIVE', 'kalos-token', 0, 1, TRUE),
    ('kalos-the-guardian', 'EASY', 'HEROIC', 'kalos-token', 0, 1, FALSE),
    ('kalos-the-guardian', 'CHAOS', 'INTERACTIVE', 'kalos-token', 5, 1, TRUE),
    ('kalos-the-guardian', 'CHAOS', 'HEROIC', 'kalos-token', 2, 1, FALSE),
    ('kalos-the-guardian', 'EXTREME', 'INTERACTIVE', 'kalos-token', 14, 1, TRUE),
    ('kalos-the-guardian', 'EXTREME', 'HEROIC', 'kalos-token', 3, 1, FALSE),
    ('baldrix', 'NORMAL', 'INTERACTIVE', 'trace-eternal-loyalty', 1, 1, FALSE),
    ('baldrix', 'NORMAL', 'HEROIC', 'trace-eternal-loyalty', 1, 1, FALSE),
    ('baldrix', 'HARD', 'INTERACTIVE', 'trace-eternal-loyalty', 2, 1, FALSE),
    ('baldrix', 'HARD', 'HEROIC', 'trace-eternal-loyalty', 2, 1, FALSE),
    ('jupiter', 'NORMAL', 'INTERACTIVE', 'lingering-twisted-desire', 1, 1, FALSE),
    ('jupiter', 'NORMAL', 'HEROIC', 'lingering-twisted-desire', 1, 1, FALSE),
    ('jupiter', 'HARD', 'INTERACTIVE', 'lingering-twisted-desire', 2, 1, FALSE),
    ('jupiter', 'HARD', 'HEROIC', 'lingering-twisted-desire', 2, 1, FALSE),
    ('kalos-the-guardian', 'NORMAL', 'INTERACTIVE', 'kalos-residual-determination-fragment', 3, 1, TRUE),
    ('kalos-the-guardian', 'NORMAL', 'HEROIC', 'kalos-residual-determination-fragment', 2, 1, FALSE),
    ('kaling', 'EASY', 'INTERACTIVE', 'ferocious-entanglement-ring-fragment', 1, 1, TRUE),
    ('kaling', 'EASY', 'HEROIC', 'ferocious-entanglement-ring-fragment', 1, 1, FALSE),
    ('kaling', 'NORMAL', 'INTERACTIVE', 'ferocious-entanglement-ring-fragment', 5, 1, TRUE),
    ('kaling', 'NORMAL', 'HEROIC', 'ferocious-entanglement-ring-fragment', 2, 1, FALSE),
    ('first-adversary', 'NORMAL', 'INTERACTIVE', 'whisper-ancient-resolve', 4, 1, TRUE),
    ('first-adversary', 'NORMAL', 'HEROIC', 'whisper-ancient-resolve', 2, 1, FALSE),
    ('malefic-star', 'NORMAL', 'INTERACTIVE', 'blissful-fantasy-fragment', 6, 1, TRUE),
    ('malefic-star', 'NORMAL', 'HEROIC', 'blissful-fantasy-fragment', 2, 1, FALSE)
) AS v (boss_key, difficulty, world, vision_key, quantity, stack_size, pooled)
JOIN boss_catalog b ON b.boss_key = v.boss_key
JOIN token_catalog t ON t.vision_key = v.vision_key;
