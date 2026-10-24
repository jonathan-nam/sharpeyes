-- Two linked accounts that each kept a party for the same night, combined into one (CombineParties.kt).
--
-- Nothing moves. Each book keeps what it logged before, and a night both of them logged must not be
-- read across, or it is counted once in each book. So the other owner reads the kept party from a
-- cutoff on, and the kept party's owner reads none of the retired one.

-- Which part of a party's pool another account reads (SharedBooks.kt). No row reads it all, the
-- rule before V98. A row reads drops on or after shared_from, and none when it is NULL.
CREATE TABLE party_read_cutoff
(
    party_id    UUID NOT NULL REFERENCES party (id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    shared_from DATE,
    PRIMARY KEY (party_id, user_id)
);

-- The retired party, pointing at the one it was combined into.
ALTER TABLE party
    ADD COLUMN combined_into UUID REFERENCES party (id) ON DELETE SET NULL;

-- A proposal waiting on the other owner. Accepting combines and deletes it.
CREATE TABLE party_combine
(
    id              UUID PRIMARY KEY,
    keep_party_id   UUID        NOT NULL REFERENCES party (id) ON DELETE CASCADE,
    retire_party_id UUID        NOT NULL REFERENCES party (id) ON DELETE CASCADE,
    proposed_by     TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL,
    UNIQUE (keep_party_id, retire_party_id),
    CHECK (keep_party_id <> retire_party_id)
);

CREATE INDEX party_combine_retire_idx ON party_combine (retire_party_id);
