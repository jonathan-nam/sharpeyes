# auth

Who you are, and a token the backend will accept.

Better Auth, signing in with Discord, running as its own Node service beside Postgres on the box.

## Why it is a service and not part of the Next app

The usual Better Auth setup puts its route handlers inside the Next app. Ours cannot: the frontend
is on Vercel and Postgres publishes no port off the Lightsail box (`ports: !reset []`), so a handler
running on Vercel has no database to reach. It lives here instead, on the box, and Caddy serves it
from the API hostname under `/api/auth`, so there is no second DNS record and no second certificate.

## How the backend trusts it

It does not talk to this service at all. This service publishes a JWKS; the backend fetches the keys
once, caches them, and verifies every request's token offline. That is what lets the two deploy
independently, and it is why a restart here interrupts starting a session and not using one.

**The algorithm is ES256 and must stay ES256.** Better Auth defaults to EdDSA (Ed25519), and the
backend verifies through auth0's `java-jwt`, which implements HMAC, RSA and ECDSA and has no EdDSA
at all. On the default this service starts, serves a JWKS, mints tokens, and the backend 401s every
single request without ever naming the reason. `SessionJwtTest` in the backend pins the working
shape.

## The database

Better Auth's tables are Flyway's, like every other table here, so the database has one migration
story and the nightly dump restores a system that works.

They are `auth_` prefixed because `users` already means something else: that one is the app's own
account row, keyed on this service's user id arriving as a JWT `sub`. Nothing joins across the two
in SQL.

The DDL is generated, never hand-written:

```bash
pnpm run schema     # prints what the pinned better-auth expects
```

Bumping `better-auth` means running that again and diffing. New output is a **new** migration, never
an edit to an applied one.

## Environment

| Variable | What it is |
| --- | --- |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USERNAME` / `DB_PASSWORD` | the same Postgres the backend uses |
| `AUTH_BASE_URL` | where a **browser** reaches this service. Lands in the token's `iss` and in every OAuth redirect |
| `AUTH_SECRET` | encrypts the signing keys at rest. Losing it invalidates every session at once |
| `AUTH_AUDIENCE` | what the backend checks `aud` against. Both sides must agree |
| `AUTH_TRUSTED_ORIGINS` | comma-separated origins allowed to call this service |
| `AUTH_COOKIE_DOMAIN` | optional. The parent domain **with a leading dot**, so the frontend on the apex shares the session |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | from <https://discord.com/developers/applications> |

Nothing is defaulted. A service that boots on a placeholder and then fails every sign-in is worse
than one that will not start, and that failure has already cost debugging time twice on the JWKS URL
alone.

## Discord

Register the redirect URI in the Discord application, exactly:

- dev: `http://localhost:3001/api/auth/callback/discord`
- prod: `https://api.sharpeyes.gg/api/auth/callback/discord`

Discord matches it character for character, a trailing slash included.

One thing worth knowing: Discord returns **no email at all** for a phone-only account, even with the
`email` scope granted. Better Auth refuses a sign-in with no email, so `src/auth.ts` synthesises one
from the Discord snowflake under `discord.invalid` and leaves it unverified. Unverified on purpose:
`emailVerified` is what account linking matches on, and a made-up address must never link two people
together.
