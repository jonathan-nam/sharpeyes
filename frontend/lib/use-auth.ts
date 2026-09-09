"use client";

import { useEffect } from "react";
import { authClient, rememberSession } from "./auth-client";
import { getSessionToken } from "./session-token";

/**
 * The session, and a token to spend on the API.
 *
 * `getToken` is passed around rather than called through this hook (see apiFetch), because roughly
 * a hundred call sites need one and half of them are event handlers, where a hook cannot run.
 *
 * The two auth round trips are SEQUENTIAL by construction, and deliberately left that way. Every
 * page waits on `isLoaded` before calling getToken, so `useSession()`'s request has to finish
 * before the token's can start, and only then does the first data request go out.
 *
 * They could overlap: `/api/auth/token` needs the cookie and nothing else, so it does not actually
 * depend on the session having answered, and `rememberSession` already records whether one existed
 * last time. That would save one round trip, about 40ms at the ~40ms RTT measured against prod.
 *
 * Not done, because this gate is where #412 came from: a refetch raced the token, went out as
 * `Bearer null`, 401'd, and a Hard Kaling night was logged twice at 60 coupons. auth-gate.test.ts
 * exists because of it. 40ms is not worth reopening that, and lib/rum.ts now reports `auth-ready`
 * so the number is measured rather than argued about if it ever looks worse than this.
 */
export function useAuth(): {
  getToken: () => Promise<string | null>;
  isSignedIn: boolean;
  isLoaded: boolean;
} {
  const { data, isPending } = authClient.useSession();
  const signedIn = !!data?.session;

  // Written here rather than at sign-in, so it also self-corrects: a session that expired or was
  // revoked elsewhere clears the flag the next time any page asks. See HAS_SESSION_KEY.
  useEffect(() => {
    if (!isPending) rememberSession(signedIn);
  }, [isPending, signedIn]);

  return { getToken: getSessionToken, isSignedIn: signedIn, isLoaded: !isPending };
}

/** The signed-in user, or undefined until the session is known. */
export function useSessionUser() {
  const { data, isPending } = authClient.useSession();
  return { user: data?.user, isLoaded: !isPending };
}
