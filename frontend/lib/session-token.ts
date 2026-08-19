"use client";

import { AUTH_BASE_PATH, authClient } from "./auth-client";

/**
 * The bearer token every API call carries, held rather than re-asked for.
 *
 * The session lives in an httpOnly cookie on the auth service; the backend wants a JWT. Trading one
 * for the other is a network round trip, and apiFetch asks before EVERY request (see lib/timing.ts,
 * which times it separately for exactly this reason). Uncached, opening a page would spend eighteen
 * round trips on tokens before the first byte of data was requested.
 *
 * So: one token, reused until it is nearly expired, and one in-flight request no matter how many
 * callers arrive at once. The concurrency guard is not an optimisation. A page mounts many
 * components in the same tick and they all call this before any of them has an answer.
 */

const AUTH_BASE_URL = process.env.NEXT_PUBLIC_AUTH_BASE_URL ?? "";

/**
 * Refetch this long before `exp` rather than at it.
 *
 * A token that expires in flight is a 401 on a request the user watched succeed. The backend allows
 * 30s of clock skew (Security.kt), so this is deliberately larger than that.
 */
const REFRESH_MARGIN_MS = 60_000;

let held: { token: string; expiresAtMs: number } | null = null;
let inFlight: Promise<string | null> | null = null;

/** `exp` without verifying anything: this token is about to be sent to someone who WILL verify it. */
function expiryOf(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function fetchToken(): Promise<string | null> {
  const response = await fetch(`${AUTH_BASE_URL}${AUTH_BASE_PATH}/token`, {
    credentials: "include",
  });
  if (!response.ok) return null;

  const { token } = (await response.json()) as { token?: string };
  if (!token) return null;

  // No readable `exp` means no idea when it dies, so it is used once and not held. Better a round
  // trip per call than a token cached past the point it works.
  const expiresAtMs = expiryOf(token);
  held = expiresAtMs === null ? null : { token, expiresAtMs };
  return token;
}

export async function getSessionToken(): Promise<string | null> {
  if (held && Date.now() < held.expiresAtMs - REFRESH_MARGIN_MS) return held.token;
  inFlight ??= fetchToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Called on sign-out, and on any 401: the held token has outlived whatever it stood for. */
export function forgetSessionToken(): void {
  held = null;
}

/** Signing out has to drop the token too, or the next call sends a bearer for a dead session. */
export async function signOut(): Promise<void> {
  forgetSessionToken();
  await authClient.signOut();
}
