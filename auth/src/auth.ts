import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { Pool } from "pg";

import { sendPasswordReset, sendVerification } from "./email.js";
import { env, flag, optionalEnv } from "./env.js";

/**
 * Identity for SharpEyes: who you are, and a token the Ktor backend can check.
 *
 * This runs as its own service next to Postgres rather than inside the Next app, because the Next
 * app is on Vercel and the database publishes no port off the box. See docs/deploy.md.
 *
 * The backend never talks to this service. It reads the JWKS below and verifies tokens offline,
 * which is the same arrangement Clerk had and the reason the swap touches so little of it.
 */

const AUTH_BASE_PATH = "/api/auth";

/**
 * Whether an email and password is a way in, alongside Discord.
 *
 * Off is a real deploy, not a half-built one: Discord alone signs everybody in, and nothing here
 * sends email, so no mail vendor is needed to run. Turning it on later is this variable plus
 * RESEND_API_KEY, no code change and no migration. V67 already carries the columns it needs.
 *
 * Nobody who signed up before it was on is stranded, either. `reset-password` CREATES a credential
 * account when the user has none, so "forgot password" is also how an existing Discord user sets
 * one for the first time.
 */
export const PASSWORD_LOGIN = flag("AUTH_PASSWORD_LOGIN");

/**
 * Origins allowed to call this service, used for BOTH Better Auth's own check and the CORS headers
 * in server.ts. Deliberately one list: an origin trusted by one and refused by the other is a
 * request that dies in the browser with nothing logged here to explain it.
 */
export const TRUSTED_ORIGINS = env("AUTH_TRUSTED_ORIGINS")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/** IANA-reserved, so a synthesised address can never collide with or be mistaken for a real one. */
const NO_EMAIL_DOMAIN = "discord.invalid";

export const pool = new Pool({
  host: env("DB_HOST"),
  port: Number(env("DB_PORT")),
  database: env("DB_NAME"),
  user: env("DB_USERNAME"),
  password: env("DB_PASSWORD"),
});

/**
 * The Discord username, which is what a friend request is addressed to (V86), and the avatar every
 * shared party and the People page draw.
 *
 * At every sign-in and on discord-profiles.ts's timer, because both can change. The avatar is
 * written to an EXISTING account's user row: Better Auth only sets it at sign-up, and on a sign-up
 * there is no account yet, so this touches nothing and Better Auth's own write stands. A failure is
 * logged and the sign-in goes ahead: nobody should be locked out over a name or a picture.
 */
export async function recordDiscordProfile(
  db: Pool,
  discordId: string,
  username: string,
  image: string | null,
) {
  try {
    await db.query(
      `INSERT INTO discord_username (discord_id, username, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (discord_id) DO UPDATE SET username = EXCLUDED.username, updated_at = now()`,
      [discordId, username],
    );
    await db.query(
      `UPDATE auth_user SET image = $2, "updatedAt" = now()
        WHERE id IN (SELECT "userId" FROM auth_account WHERE "providerId" = 'discord' AND "accountId" = $1)
          AND image IS DISTINCT FROM $2`,
      [discordId, image],
    );
  } catch (e) {
    console.error("could not record the Discord profile", e);
  }
}

export const auth = betterAuth({
  database: pool,

  basePath: AUTH_BASE_PATH,
  baseURL: env("AUTH_BASE_URL"),
  secret: env("AUTH_SECRET"),

  // Prefixed, because the app already has a `users` table meaning something else: this one is the
  // identity record, that one is the account's own rows keyed on the token's `sub`. Unprefixed,
  // Better Auth would take `user` and leave two tables one letter apart.
  user: { modelName: "auth_user" },
  session: { modelName: "auth_session" },
  verification: { modelName: "auth_verification" },

  // A password of your own, so an account does not depend on still having the Discord one.
  //
  // Verification is required before a password account can sign in. That is not ceremony: an
  // unverified address is one anybody could have typed, and the linking rule below decides who you
  // ARE from a verified address.
  emailAndPassword: {
    enabled: PASSWORD_LOGIN,
    requireEmailVerification: true,
    // Above the library's default of 8. A password manager makes the difference free, and this is
    // the only credential on the account that a person chooses.
    minPasswordLength: 12,
    sendResetPassword: ({ user, url }) => sendPasswordReset(user.email, url),
  },

  emailVerification: {
    sendOnSignUp: true,
    // Straight into the app from the link. Making somebody verify and then sign in again is two
    // steps for one intention.
    autoSignInAfterVerification: true,
    sendVerificationEmail: ({ user, url }) => sendVerification(user.email, url),
  },

  // Signing in with Discord as somebody who already has a password account, or the reverse, lands
  // in the SAME account only when BOTH addresses are verified.
  //
  // That is Better Auth's default and it is left alone on purpose. **Do not add `trustedProviders`
  // here.** Naming discord in it means "believe this provider's email without it being verified",
  // and Discord hands back an unverified address for an unconfirmed account, plus a synthesised
  // `@discord.invalid` one for phone-only accounts (see mapProfileToUser below). Trusting either
  // would let somebody who knows your email walk into your account.
  account: {
    modelName: "auth_account",
    accountLinking: { enabled: true },
  },

  socialProviders: {
    discord: {
      clientId: env("DISCORD_CLIENT_ID"),
      clientSecret: env("DISCORD_CLIENT_SECRET"),
      // Show Discord's approval screen every time. Better Auth's discord provider defaults this to
      // `none`, which asks Discord to skip the screen for anybody who has authorised the app once
      // already, so a returning user is bounced straight through without being asked.
      prompt: "consent",
      // Discord returns no email at all for a phone-only account, even with the email scope
      // granted, and Better Auth refuses a sign-in with no email. Synthesised from the Discord
      // snowflake, which is stable and unique. Left unverified on purpose: `emailVerified` is what
      // account linking matches on, and a made-up address must never link two people together.
      mapProfileToUser: async (profile) => {
        await recordDiscordProfile(pool, profile.id, profile.username, profile.image_url);
        return profile.email
          ? {}
          : { email: `${profile.id}@${NO_EMAIL_DOMAIN}`, emailVerified: false };
      },
    },
  },

  plugins: [
    jwt({
      // Prefixed like the four core tables above, so everything this service owns reads as one
      // group on a database it shares with the app.
      schema: { jwks: { modelName: "auth_jwks" } },
      jwks: {
        // ES256, NOT the EdDSA default. The backend verifies through auth0's java-jwt, which
        // implements HMAC, RSA and ECDSA and has no EdDSA at all. Left on the default this service
        // starts, serves a JWKS, mints tokens, and every backend request 401s on a signature it
        // cannot even name an algorithm for.
        keyPairConfig: { alg: "ES256" },
      },
      jwt: {
        // Its own variable, because AUTH_BASE_URL is where the browser signs in (the frontend's
        // origin in prod, proxied here) and `iss` is what the backend's AUTH_ISSUER checks.
        issuer: optionalEnv("AUTH_ISSUER") ?? env("AUTH_BASE_URL"),
        audience: env("AUTH_AUDIENCE"),
      },
    }),
  ],

  // Both halves of the site sit under one registrable domain (sharpeyes.app and its subdomains), so
  // the session cookie is same-site and Safari's tracking prevention does not touch it. The apex is
  // the frontend on Vercel; this service is behind nginx on the box.
  advanced: {
    crossSubDomainCookies: optionalEnv("AUTH_COOKIE_DOMAIN")
      ? { enabled: true, domain: optionalEnv("AUTH_COOKIE_DOMAIN")! }
      : { enabled: false },
  },

  trustedOrigins: TRUSTED_ORIGINS,

  // Where a sign-in that fails before its own errorCallbackURL is known lands (a lost or replayed
  // state). Unset, it was this service's own address, which has no page to show.
  onAPIError: { errorURL: optionalEnv("AUTH_ERROR_URL") },
});

/** Where the backend's JWKS_URL has to point. Exported so a test can assert the two agree. */
export const JWKS_PATH = `${AUTH_BASE_PATH}/jwks`;
