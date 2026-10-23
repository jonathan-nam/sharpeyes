-- A party seat offered to a friend's character, waiting on them.
--
-- Until now naming a linked account's character in a roster seated it at once (V75). Seating is now
-- the invitee's act: the owner's save writes a row here instead, the invitee gets a notification,
-- and only Accept writes the seat. No seat exists while this row does, so a pending invite never
-- takes a share of anything.
CREATE TABLE party_invite (
    id           UUID PRIMARY KEY,
    party_id     UUID        NOT NULL REFERENCES party (id) ON DELETE CASCADE,
    character_id UUID        NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
    invited_by   TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL,
    -- Inviting twice is one invite.
    UNIQUE (party_id, character_id)
);

CREATE INDEX party_invite_character_idx ON party_invite (character_id);
