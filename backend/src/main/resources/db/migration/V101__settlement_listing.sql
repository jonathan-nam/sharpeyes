-- Auction house listings posted against a Settlement card, and the figure each was posted for.
--
-- A card is a person row between two linked accounts (the owner's row naming the member). `payer` is
-- the side holding the money: OWNER or MEMBER. The other side posts the listing.
--
-- The backend cannot work a settlement figure out (lib/settlement.ts does), so the browsers report
-- it. A listing whose amount no longer matches the reported figure is deleted. See
-- parties/SettlementListings.kt.

-- What the payer's own screen last said they hold, one per card and direction. Only the payer's
-- report is kept: a change in it is what tells the payee their split moved.
CREATE TABLE settlement_figure (
    id         UUID PRIMARY KEY,
    person_id  UUID        NOT NULL REFERENCES person (id) ON DELETE CASCADE,
    payer      TEXT        NOT NULL CHECK (payer IN ('OWNER', 'MEMBER')),
    amount     BIGINT      NOT NULL CHECK (amount >= 0),
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (person_id, payer)
);

-- One listing per card and direction: posting again replaces it.
CREATE TABLE settlement_listing (
    id           UUID PRIMARY KEY,
    person_id    UUID        NOT NULL REFERENCES person (id) ON DELETE CASCADE,
    payer        TEXT        NOT NULL CHECK (payer IN ('OWNER', 'MEMBER')),
    amount       BIGINT      NOT NULL CHECK (amount > 0),
    posted_by    TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    content_type TEXT        NOT NULL,
    image        BYTEA       NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    UNIQUE (person_id, payer)
);
