import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { Pool } from "pg";

import { env, optionalEnv } from "./env.js";

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

/** IANA-reserved, so a synthesised address can never collide with or be mistaken for a real one. */
const NO_EMAIL_DOMAIN = "discord.invalid";

export const auth = betterAuth({
  database: new Pool({
    host: env("DB_HOST"),
    port: Number(env("DB_PORT")),
    database: env("DB_NAME"),
    user: env("DB_USERNAME"),
    password: env("DB_PASSWORD"),
  }),

  basePath: AUTH_BASE_PATH,
  baseURL: env("AUTH_BASE_URL"),
  secret: env("AUTH_SECRET"),

  // Prefixed, because the app already has a `users` table meaning something else: this one is the
  // identity record, that one is the account's own rows keyed on the token's `sub`. Unprefixed,
  // Better Auth would take `user` and leave two tables one letter apart.
  user: { modelName: "auth_user" },
  session: { modelName: "auth_session" },
  account: { modelName: "auth_account" },
  verification: { modelName: "auth_verification" },

  socialProviders: {
    discord: {
      clientId: env("DISCORD_CLIENT_ID"),
      clientSecret: env("DISCORD_CLIENT_SECRET"),
      // Discord returns no email at all for a phone-only account, even with the email scope
      // granted, and Better Auth refuses a sign-in with no email. Synthesised from the Discord
      // snowflake, which is stable and unique. Left unverified on purpose: `emailVerified` is what
      // account linking matches on, and a made-up address must never link two people together.
      mapProfileToUser: (profile) =>
        profile.email
          ? {}
          : { email: `${profile.id}@${NO_EMAIL_DOMAIN}`, emailVerified: false },
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
        issuer: env("AUTH_BASE_URL"),
        audience: env("AUTH_AUDIENCE"),
      },
    }),
  ],

  // Both halves of the site sit under one registrable domain (sharpeyes.gg and its subdomains), so
  // the session cookie is same-site and Safari's tracking prevention does not touch it. The apex is
  // the frontend on Vercel; this service is behind Caddy on the box.
  advanced: {
    crossSubDomainCookies: optionalEnv("AUTH_COOKIE_DOMAIN")
      ? { enabled: true, domain: optionalEnv("AUTH_COOKIE_DOMAIN")! }
      : { enabled: false },
  },

  trustedOrigins: env("AUTH_TRUSTED_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
});

/** Where the backend's JWKS_URL has to point. Exported so a test can assert the two agree. */
export const JWKS_PATH = `${AUTH_BASE_PATH}/jwks`;
