import type { Pool } from "pg";

import { recordDiscordUsername } from "./auth.js";
import { env } from "./env.js";

type Row = { id: string; accountId: string; accessToken: string | null; refreshToken: string | null };

async function usernameWith(accessToken: string): Promise<string | null> {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  return ((await response.json()) as { username?: string }).username ?? null;
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
 * Usernames for Discord accounts that signed in before they were recorded (V86).
 *
 * At boot, and only for accounts with none, so it does nothing once every one is filled. A session
 * outlives a sign-in by weeks, and without this a friend request to them finds nobody.
 */
export async function backfillDiscordUsernames(db: Pool): Promise<void> {
  const { rows } = await db.query<Row>(
    `SELECT a.id, a."accountId", a."accessToken", a."refreshToken"
       FROM auth_account a
       LEFT JOIN discord_username d ON d.discord_id = a."accountId"
      WHERE a."providerId" = 'discord' AND d.discord_id IS NULL`,
  );
  let filled = 0;
  for (const row of rows) {
    try {
      let username = row.accessToken ? await usernameWith(row.accessToken) : null;
      if (username === null) {
        const token = await refreshed(db, row);
        username = token ? await usernameWith(token) : null;
      }
      if (username !== null) {
        await recordDiscordUsername(db, row.accountId, username);
        filled++;
      }
    } catch (e) {
      console.error("could not backfill a Discord username", e);
    }
  }
  if (rows.length > 0) console.log(`Discord usernames backfilled: ${filled} of ${rows.length}`);
}
