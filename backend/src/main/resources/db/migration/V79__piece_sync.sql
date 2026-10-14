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
    -- Pieces per stack, the smallest thing a party can hand out. 3 for Hard Malefic Star, else 1.
    stack_size       INT NOT NULL CHECK (stack_size >= 1),
    -- One pile for the whole party, so `quantity` is one character's only when they ran alone.
    pooled           BOOLEAN NOT NULL,
    PRIMARY KEY (boss_catalog_id, difficulty, world)
);

-- How a party usually divides a pooled pile of pieces, per seat, 1 unless somebody carries. Its own
-- ratio rather than `shares`: who loots pieces is decided apart from who is paid for coupons.
ALTER TABLE party_member ADD COLUMN piece_shares INT NOT NULL DEFAULT 1 CHECK (piece_shares >= 0);

-- One week's pooled pile on a party, added on Party View from the config's mode and ratio, the way
-- a party adds its coupons. Never party_loot: pieces cannot be traded, so they must stay out of the Drop
-- Log, sales and settlement, all of which read party_loot.
CREATE TABLE party_piece_pile (
    party_id         UUID NOT NULL REFERENCES party (id) ON DELETE CASCADE,
    period_start     DATE NOT NULL,
    token_catalog_id UUID NOT NULL REFERENCES token_catalog (id) ON DELETE CASCADE,
    difficulty       TEXT NOT NULL,
    total            INT NOT NULL CHECK (total >= 0),
    stack_size       INT NOT NULL CHECK (stack_size >= 1),
    filed_at         TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (party_id, period_start)
);

CREATE INDEX idx_party_piece_pile_token_catalog_id ON party_piece_pile (token_catalog_id);

-- What each seat took of that pile. Sums to the pile's total.
CREATE TABLE party_piece_take (
    party_id     UUID NOT NULL,
    period_start DATE NOT NULL,
    member_id    UUID NOT NULL REFERENCES party_member (id) ON DELETE CASCADE,
    quantity     INT NOT NULL CHECK (quantity >= 0),
    PRIMARY KEY (party_id, period_start, member_id),
    FOREIGN KEY (party_id, period_start) REFERENCES party_piece_pile (party_id, period_start) ON DELETE CASCADE
);

CREATE INDEX idx_party_piece_take_member_id ON party_piece_take (member_id);

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
