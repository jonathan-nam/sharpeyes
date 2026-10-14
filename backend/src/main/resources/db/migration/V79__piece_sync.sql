-- Eternal pieces added to the inventory by a boss clear. See tokens/PieceSync.kt.

-- What one clear puts in one character's inventory. Seeded by R__token_catalog.sql from the
-- `per_clear` counts in catalog/items.yaml. A zero row is a mode that drops none; no row for a boss
-- that has others is a mode nobody counted, and the sync refuses it rather than adding nothing.
CREATE TABLE token_clear_amount (
    boss_catalog_id  UUID NOT NULL REFERENCES boss_catalog (id) ON DELETE CASCADE,
    difficulty       TEXT NOT NULL,
    world            TEXT NOT NULL CHECK (world IN ('INTERACTIVE', 'HEROIC')),
    token_catalog_id UUID NOT NULL REFERENCES token_catalog (id) ON DELETE CASCADE,
    quantity         INT NOT NULL CHECK (quantity >= 0),
    -- One pile for the whole party, so `quantity` is one character's only when they ran alone.
    pooled           BOOLEAN NOT NULL,
    PRIMARY KEY (boss_catalog_id, difficulty, world)
);

ALTER TABLE users ADD COLUMN sync_pieces_from_clears BOOLEAN NOT NULL DEFAULT FALSE;

-- One row per clear the sync has accounted for, so re-ticking cannot add twice and un-ticking
-- takes back exactly what was added.
CREATE TABLE piece_clear_credit (
    character_id     UUID NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
    boss_catalog_id  UUID NOT NULL REFERENCES boss_catalog (id) ON DELETE CASCADE,
    period_start     DATE NOT NULL,
    token_catalog_id UUID NOT NULL REFERENCES token_catalog (id) ON DELETE CASCADE,
    quantity         INT NOT NULL CHECK (quantity > 0),
    credited_at      TIMESTAMPTZ NOT NULL,
    -- The count the sync left behind. NULL when the clear came in with a capture that read the
    -- inventory too, whose count already included the drop, so nothing was added.
    count_after      INT,
    PRIMARY KEY (character_id, boss_catalog_id, period_start)
);

CREATE INDEX idx_piece_clear_credit_boss_catalog_id ON piece_clear_credit (boss_catalog_id);
CREATE INDEX idx_piece_clear_credit_token_catalog_id ON piece_clear_credit (token_catalog_id);
