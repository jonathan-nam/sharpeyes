import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { toNodeHandler } from "better-auth/node";

import { auth, PASSWORD_LOGIN, pool, TRUSTED_ORIGINS } from "./auth.js";
import { backfillDiscordUsernames } from "./backfill.js";
import { assertCanSendEmail } from "./email.js";
import { env, optionalEnv } from "./env.js";

// Before the listener, so a service that cannot send a password reset never accepts a sign-up.
// Only when passwords are a way in: Discord-only sends no email and needs no mail vendor.
if (PASSWORD_LOGIN) assertCanSendEmail();

const port = Number(optionalEnv("PORT") ?? 3001);
const handler = toNodeHandler(auth);

/**
 * CORS, which Better Auth does not do for us and which nothing here needed until now.
 *
 * The documented setup puts these routes inside the Next app, where every call is same-origin.
 * Ours is a separate service on a separate port, so the browser preflights and then refuses. It
 * fails as a bare "Failed to fetch" in the console with no mention of CORS, and the request never
 * leaves the browser, so the service logs nothing at all. Curl cannot see it either: curl does not
 * preflight. Only a browser reproduces this.
 *
 * The origin is ECHOED, never `*`. These requests carry the session cookie, and a wildcard is
 * invalid with credentials: the browser rejects the response rather than the request. Same rule as
 * the backend's Cors.kt, for the same reason.
 */
function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;

  if (origin && TRUSTED_ORIGINS.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    // Origin decides the response, so caches must key on it. Without this a proxy can serve one
    // origin's allow-header to another.
    response.setHeader("Vary", "Origin");
  }

  // The preflight itself. It never reaches the auth handler, which would 404 it: OPTIONS is not a
  // route any of these endpoints declare.
  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    response.setHeader("Access-Control-Max-Age", "86400");
    response.writeHead(204);
    response.end();
    return true;
  }

  return false;
}

/**
 * The backfill, retried until its table exists.
 *
 * This service starts BEFORE the backend (backend depends_on auth), and the backend is what runs the
 * migration that creates discord_username. So on the deploy that adds it, the first try always fails.
 */
async function backfillWhenMigrated() {
  for (;;) {
    try {
      await backfillDiscordUsernames(pool);
      return;
    } catch (e) {
      console.error("Discord username backfill will retry in a minute", e);
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  }
}

const server = createServer((request, response) => {
  if (applyCors(request, response)) return;

  // Its own path, answered before the handler, so an orchestrator can tell "the process is up"
  // from "Discord is reachable". Compose reads this one.
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  void handler(request, response);
});

server.listen(port, () => {
  // Named at startup because the one thing that silently breaks the backend is this service
  // serving a JWKS the backend is not reading. Both values in one line make that mismatch visible.
  console.log(`auth listening on :${port}, issuing for ${env("AUTH_BASE_URL")}`);
  void backfillWhenMigrated();
});
