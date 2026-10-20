-- What a member may do in a party somebody else owns, beyond reading it. Mirrors db/Tables.kt.
--
-- Keyed by ACCOUNT, not by seat: two characters of one member in one party are one person with one
-- say. No row is a Viewer, which is what every member was before this, so nothing needs backfilling.
-- Reaching the party at all is still a standing seat (isSeatedIn); a row for somebody with none
-- grants nothing.

CREATE TABLE party_role (
    party_id   UUID        NOT NULL REFERENCES party(id) ON DELETE CASCADE,
    user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT        NOT NULL CHECK (role IN ('EDITOR')),
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (party_id, user_id)
);
