"use client";

import { createAuthClient } from "better-auth/react";

/** Matches the service's own basePath. Both halves have to agree or every call 404s. */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * The browser's half of the auth service (see auth/).
 *
 * `baseURL` is a different origin from this app in every environment: the frontend is on Vercel and
 * the auth service is behind Caddy on the box. Both sit under one registrable domain, so the
 * session cookie is same-site and Safari's tracking prevention leaves it alone.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_AUTH_BASE_URL,
  basePath: AUTH_BASE_PATH,
  fetchOptions: {
    // The session cookie is set by another origin, so it does not ride along by default.
    credentials: "include",
  },
});

/**
 * Whether a session existed last time anything looked, remembered across a reload.
 *
 * Not the session, and never trusted as one. Better Auth's session cookie is httpOnly by design, so
 * the header cannot ask before first paint whether to hold space for the signed-in controls, and
 * without an answer their arrival shifts the brand sideways (measured: 54px).
 *
 * Safe because of what it is allowed to decide: whether to HOLD SPACE, never what to show. A stale
 * value costs a reserved gap and cannot leak a signed-in view.
 */
export const HAS_SESSION_KEY = "sharpeyes.has-session";

export function rememberSession(present: boolean): void {
  try {
    if (present) {
      localStorage.setItem(HAS_SESSION_KEY, "1");
    } else {
      localStorage.removeItem(HAS_SESSION_KEY);
    }
  } catch {
    // Throws in some privacy modes. The cost is a header that reserves the wrong amount of space
    // for one paint, which is what this is for, not something it can break.
  }
}
