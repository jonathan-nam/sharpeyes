-- Better Auth's own tables: who you are, and the keys your token is signed with.
--
-- GENERATED, not hand-written. `pnpm run schema` in auth/ prints exactly this from the library at
-- the version auth/package.json pins, so the schema and the code that reads it cannot drift.
-- Bumping better-auth means running it again and diffing: new output is a NEW migration, never an
-- edit to this one.
--
-- Flyway's rather than the library's own migrator, so this database has one migration story and the
-- nightly dump restores a system that works. The two migrators would otherwise both be authoritative
-- and neither would know about the other's tables.
--
-- The identifiers are quoted camelCase, alone on this database. That is not a style slip: Better
-- Auth queries these names literally, and Postgres folds an unquoted "userId" to "userid", after
-- which every lookup finds nothing and says nothing.
--
-- `auth_` prefixed because `users` already means something else here: that one is the app's account
-- row, keyed on this one's id arriving as a token's `sub`. Nothing joins across the two in SQL.

CREATE TABLE "auth_user" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "name"          TEXT NOT NULL,
    "email"         TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL,
    "image"         TEXT,
    "createdAt"     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt"     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "auth_session" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "token"     TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId"    TEXT NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE
);

CREATE TABLE "auth_account" (
    "id"                    TEXT NOT NULL PRIMARY KEY,
    "issuer"                TEXT NOT NULL,
    "accountId"             TEXT NOT NULL,
    "providerId"            TEXT NOT NULL,
    "userId"                TEXT NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
    "accessToken"           TEXT,
    "refreshToken"          TEXT,
    "idToken"               TEXT,
    "accessTokenExpiresAt"  TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ,
    "scope"                 TEXT,
    "password"              TEXT,
    "createdAt"             TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt"             TIMESTAMPTZ NOT NULL
);

CREATE TABLE "auth_verification" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value"      TEXT NOT NULL,
    "expiresAt"  TIMESTAMPTZ NOT NULL,
    "createdAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- The signing keys themselves. The private half is encrypted with AUTH_SECRET, so losing that
-- secret is losing every key: a restarted service mints a new one and every token in flight fails.
CREATE TABLE "auth_jwks" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "publicKey"  TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt"  TIMESTAMPTZ NOT NULL,
    "expiresAt"  TIMESTAMPTZ,
    "alg"        TEXT,
    "crv"        TEXT
);

CREATE INDEX "auth_session_userId_idx" ON "auth_session" ("userId");
CREATE INDEX "auth_account_userId_idx" ON "auth_account" ("userId");
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" ("identifier");
CREATE UNIQUE INDEX "auth_account_issuer_accountId_uidx" ON "auth_account" ("issuer", "accountId");

COMMENT ON TABLE "auth_user" IS
    'Better Auth''s identity record. NOT the app''s `users` table: that one is keyed on this id '
    'arriving as a JWT `sub`, and is where world type and main character live.';
