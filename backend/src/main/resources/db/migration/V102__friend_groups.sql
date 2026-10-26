-- People who run together and add each other's characters to parties without an invite.
--
-- Since V92 naming a friend's character offers them the seat. Being in a group with somebody is that
-- consent given once: a groupmate's character is seated at once, and everybody else is still invited.
-- Joining is by invite and Accept, so nobody is put in a group, and through it in parties, unasked.
CREATE TABLE friend_group (
    id         UUID PRIMARY KEY,
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE friend_group_member (
    group_id  UUID        NOT NULL REFERENCES friend_group (id) ON DELETE CASCADE,
    user_id   TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX friend_group_member_user_idx ON friend_group_member (user_id);

CREATE TABLE friend_group_invite (
    id         UUID PRIMARY KEY,
    group_id   UUID        NOT NULL REFERENCES friend_group (id) ON DELETE CASCADE,
    user_id    TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    invited_by TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    -- Inviting twice is one invite.
    UNIQUE (group_id, user_id)
);

CREATE INDEX friend_group_invite_user_idx ON friend_group_invite (user_id);
