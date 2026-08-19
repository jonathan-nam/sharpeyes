import { type NextRequest, NextResponse } from "next/server";

// Next.js 16 renamed middleware.ts -> proxy.ts; this file plays the same role.
// /characters and /upload only redirect now (see next.config redirects and app/upload), but they
// stay gated so an unauthenticated hit lands on sign-in rather than leaking the redirect target.
const PROTECTED = [/^\/inventory(\/|$)/, /^\/characters(\/|$)/, /^\/upload(\/|$)/];

// The session cookie is set by the auth service on the API host, and scoped to the parent domain,
// so it reaches this app too. `__Secure-` is prepended wherever the base URL is https, which is
// everywhere but local dev.
const SESSION_COOKIES = ["__Secure-better-auth.session_token", "better-auth.session_token"];

/**
 * Sends a signed-out visitor to sign in instead of to an empty page.
 *
 * PRESENCE only. Verifying the token means asking the auth service, on every navigation, from the
 * edge, and this does not need to: it decides where to point somebody, not what they may read.
 * Every actual answer comes from the API, which verifies a JWT per request and does not care what
 * this file thought. A forged cookie here buys an empty page shell and 401s.
 */
export default function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!PROTECTED.some((pattern) => pattern.test(path))) return NextResponse.next();

  const signedIn = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (signedIn) return NextResponse.next();

  const home = new URL("/", request.url);
  return NextResponse.redirect(home);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
