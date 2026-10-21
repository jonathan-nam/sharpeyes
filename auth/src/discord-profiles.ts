import type { Pool } from "pg";

import { recordDiscordProfile } from "./auth.js";
import { env } from "./env.js";

// Every Discord account's username and avatar, re-read from Discord on a timer. A session outlives a
// sign-in by weeks, so without this a changed picture would stay the old one until they next signed
// in, and an account that signed in before usernames were recorded (V86) would never be findable.

type Row = { id: string; accountId: string; accessToken: string | null; refreshToken: string | null };
type Profile = { id: string; username: string; avatar: string | null; discriminator: string };

/** Hourly: often enough that a new picture shows the same day, and a handful of requests per user. */
export const SYNC_EVERY_MS = 60 * 60 * 1000;

/** The avatar URL, built exactly as Better Auth's discord provider builds it at sign-up. */
export function avatarOf(profile: Profile): string {
  if (profile.avatar === null) {
    const index =
      profile.discriminator === "0"
        ? Number(BigInt(profile.id) >> BigInt(22)) % 6
        : parseInt(profile.discriminator) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  const format = profile.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${format}`;
}

async function profileWith(accessToken: string): Promise<Profile | null> {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  return (await response.json()) as Profile;
}

/** A fresh access token, written back: Discord rotates the refresh token on every use. */
async function refreshed(db: Pool, row: Row): Promise<string | null> {
  if (!row.refreshToken) return null;
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("DISCORD_CLIENT_ID"),
      client_secret: env("DISCORD_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: row.refreshToken,
    }),
  });
  if (!response.ok) return null;
  const token = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  await db.query(
    `UPDATE auth_account SET "accessToken" = $2, "refreshToken" = $3,
       "accessTokenExpiresAt" = now() + make_interval(secs => $4), "updatedAt" = now()
     WHERE id = $1`,
    [row.id, token.access_token, token.refresh_token, token.expires_in],
  );
  return token.access_token;
}

/**
 * One pass over every Discord account. An account whose tokens no longer work (they revoked the
 * app) keeps what it had, and is tried again next pass.
 */
export async function syncDiscordProfiles(db: Pool): Promise<void> {
  const { rows } = await db.query<Row>(
    `SELECT id, "accountId", "accessToken", "refreshToken"
       FROM auth_account WHERE "providerId" = 'discord'`,
  );
  let synced = 0;
  for (const row of rows) {
    try {
      let profile = row.accessToken ? await profileWith(row.accessToken) : null;
      if (profile === null) {
        const token = await refreshed(db, row);
        profile = token ? await profileWith(token) : null;
      }
      if (profile !== null) {
        await recordDiscordProfile(db, row.accountId, profile.username, avatarOf(profile));
        synced++;
      }
    } catch (e) {
      console.error("could not sync a Discord profile", e);
    }
  }
  if (synced < rows.length) console.log(`Discord profiles synced: ${synced} of ${rows.length}`);
}
