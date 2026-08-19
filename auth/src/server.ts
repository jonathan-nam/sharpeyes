import { createServer } from "node:http";

import { toNodeHandler } from "better-auth/node";

import { auth } from "./auth.js";
import { env, optionalEnv } from "./env.js";

const port = Number(optionalEnv("PORT") ?? 3001);
const handler = toNodeHandler(auth);

const server = createServer((request, response) => {
  // Its own path, answered before the handler, so an orchestrator can tell "the process is up"
  // from "Discord is reachable". Compose and Caddy both read this one.
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
});
