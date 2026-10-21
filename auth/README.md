# auth

Who you are, and a token the backend will accept.

Better Auth, running as its own Node service beside Postgres on the box. Two ways in: Discord, and
an email and password of your own.

## Why it is a service and not part of the Next app

The usual Better Auth setup puts its route handlers inside the Next app. Ours cannot: the frontend
is on Vercel and Postgres publishes no port off the Lightsail box (`ports: !reset []`), so a handler
running on Vercel has no database to reach. It lives here instead, on the box, and nginx serves it
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
| `AUTH_BASE_URL` | where a **browser** reaches this service. Lands in every OAuth redirect. In prod it is the frontend's origin, which proxies `/api/auth/*` here |
| `AUTH_ISSUER` | optional. The token's `iss`, when it is not `AUTH_BASE_URL`. Must match the backend's `AUTH_ISSUER` |
| `AUTH_ERROR_URL` | optional. Where a failed sign-in lands, with `?error=` added |
| `AUTH_SECRET` | encrypts the signing keys at rest. Losing it invalidates every session at once |
| `AUTH_AUDIENCE` | what the backend checks `aud` against. Both sides must agree |
| `AUTH_TRUSTED_ORIGINS` | comma-separated origins allowed to call this service |
| `AUTH_COOKIE_DOMAIN` | optional. The parent domain **with a leading dot**, so the frontend on the apex shares the session |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | from <https://discord.com/developers/applications> |
| `RESEND_API_KEY` | sends verification and reset email. Optional locally, required over https |
| `AUTH_EMAIL_FROM` | the From address, on a domain verified in Resend |

Nothing is defaulted. A service that boots on a placeholder and then fails every sign-in is worse
than one that will not start, and that failure has already cost debugging time twice on the JWKS URL
alone.

## Email and password

A password account is independent of Discord, so losing the Discord account does not lose this one.

Two rules are load-bearing:

- **The address must be verified before it can sign in.** An unverified address is one anybody
  could have typed, and the linking rule below decides who you *are* from a verified address.
- **Linking happens only when BOTH addresses are verified.** That is Better Auth's default and it is
  deliberately left alone. **Do not add `trustedProviders`.** Naming discord there means "believe
  this provider's email without it being verified", and Discord returns an unverified address for an
  unconfirmed account plus a synthesised `@discord.invalid` one for phone-only accounts. Trusting
  either would let somebody who knows your email walk into your account.

### Mail

Resend, called over its REST API. Password reset is not optional-feeling here: without it a
forgotten password is a permanently lost account, and everything the account holds goes with it.

Locally, with no `RESEND_API_KEY`, links are **printed to this service's log** instead of sent, so
development needs no mail vendor:

```
docker compose logs -f auth
```

That fallback is local-only. `assertCanSendEmail` refuses to start a service reachable over https
without a key, because there the same behaviour is a reset that silently never arrives.

## Moving an existing account onto a new sign-in

The id in `users` used to be Clerk's. Signing in with Discord mints a different one, so an account
that existed before the swap keeps its characters, parties and ledger attached to an id nobody can
sign in as any more. The app looks empty and nothing is actually lost.

```bash
./scripts/reassign-user.sh <old-id> <new-id>
```

Sign in once first, so the new row exists, then find the new id:

```bash
docker compose exec -T postgres psql -U sharpeyes -d sharpeyes \
  -c 'select id, email from "auth_user";'
```

It moves every row in every table that references `users.id`, **read from the catalog rather than a
list in the script**. A hand-written list is one a future table falls off, and the failure would be
a move that reports success and silently leaves part of the account behind. It prints a per-table
count, carries the old row's world and main character across, and runs in one transaction.

It refuses rather than guesses: an old id that does not exist, or the same id twice, is an error and
nothing is written.

## Discord

Register the redirect URI in the Discord application, exactly:

- dev: `http://localhost:3001/api/auth/callback/discord`
- prod: `https://api.sharpeyes.app/api/auth/callback/discord`

Discord matches it character for character, a trailing slash included.

One thing worth knowing: Discord returns **no email at all** for a phone-only account, even with the
`email` scope granted. Better Auth refuses a sign-in with no email, so `src/auth.ts` synthesises one
from the Discord snowflake under `discord.invalid` and leaves it unverified. Unverified on purpose:
`emailVerified` is what account linking matches on, and a made-up address must never link two people
together.
