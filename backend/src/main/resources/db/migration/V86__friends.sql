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
