/**
 * Where a sign-on link points, and what the join page does with it.
 *
 * Kept out of the components so both ends agree on one path: the page that makes a link and the
 * route that answers it are in different files, and a disagreement between them is a link that
 * 404s only once somebody has already been sent it.
 */
export const JOIN_PATH = "/join";

export function inviteUrl(origin: string, token: string): string {
  return `${origin}${JOIN_PATH}/${encodeURIComponent(token)}`;
}

/**
 * Where Discord sends somebody back to, mid-invite.
 *
 * The same page they were on, token and all. The token is already in the URL they opened, so
 * carrying it through the round trip is a matter of asking to come back to it rather than a cookie
 * to write and then clean up.
 */
export function joinCallbackPath(token: string): string {
  return `${JOIN_PATH}/${encodeURIComponent(token)}`;
}

/**
 * What is left of a link as m:ss, or null once there is none.
 *
 * Null rather than "0:00", because a dead link and a nearly dead one are different things to say
 * and only one of them should still offer a Copy button. Seconds are floored: 0:01 with nine tenths
 * of a second behind it is a second you do not have.
 */
export function timeLeft(expiresAt: string, now: Date): string | null {
  const seconds = Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
