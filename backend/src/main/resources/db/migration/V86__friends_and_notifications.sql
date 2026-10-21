-- Friends: two accounts that found each other by Discord username, rather than by an invite link.
--
-- Accepting writes the same link an invite does (person.linked_user_id on both sides), so a friend
-- is a linked person and everything shared already keys on that. These two tables are only how the
-- request travels.

-- Written by the auth service at every Discord sign-in (auth/src/auth.ts), keyed by the Discord id
-- rather than by account: the profile arrives before Better Auth has said which user it is.
-- auth_account ("providerId" = 'discord', "accountId" = discord_id) is the join to the account.
CREATE TABLE discord_username
(
    discord_id TEXT PRIMARY KEY,
    username   TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

-- Discord lowercases usernames, but a request is typed by a person.
CREATE INDEX discord_username_lower_idx ON discord_username (lower(username));

CREATE TABLE friend_request
(
    id           UUID PRIMARY KEY,
    from_user_id TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    to_user_id   TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL,
    UNIQUE (from_user_id, to_user_id),
    CHECK (from_user_id <> to_user_id)
);

CREATE INDEX friend_request_to_idx ON friend_request (to_user_id);

-- Notifications, for any feature: a friend request now, a sale later. What a kind means is the
-- code's (notifications/NotificationKinds.kt); this only stores who, what about, and whether seen.
CREATE TABLE notification
(
    id         UUID PRIMARY KEY,
    user_id    TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       TEXT        NOT NULL,
    -- The row it is about (a friend_request, a party_loot), so answering it can clear it. No FK,
    -- because it points at a different table per kind.
    subject_id UUID,
    -- The account that caused it, shown as their main character.
    actor_id   TEXT REFERENCES users (id) ON DELETE CASCADE,
    payload    JSONB       NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL,
    read_at    TIMESTAMPTZ
);

CREATE INDEX notification_user_idx ON notification (user_id, created_at DESC);
CREATE INDEX notification_subject_idx ON notification (kind, subject_id);
