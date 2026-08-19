"use client";

import { useEffect } from "react";
import { authClient, rememberSession } from "./auth-client";
import { getSessionToken } from "./session-token";

/**
 * The session, and a token to spend on the API.
 *
 * `getToken` is passed around rather than called through this hook (see apiFetch), because roughly
 * a hundred call sites need one and half of them are event handlers, where a hook cannot run.
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
