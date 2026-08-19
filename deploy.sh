#!/usr/bin/env bash
#
# Deploy, from on the box. `ssh ubuntu@<static-ip>`, then `cd sharpeyes && ./deploy.sh`.
#
# No downtime. Two backend replicas sit behind Caddy, and this restarts one at a time, waiting for
# each to answer /health before touching the next.
#
# Measured on the real images, polling /health through Caddy every 20ms across a deploy:
#   backend change   224 requests, 0 failures, slowest 109ms
#   parser change    267 requests, 0 failures, one request waited 4.6s
# The parser is worse because both replicas share its network namespace and must restart with it.
# Caddy's lb_try_duration absorbs that gap rather than returning 502, so it costs latency once, not
# errors. Re-measure if the health check interval or the replica count changes.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
REPLICAS=("backend:8080" "backend-b:8081")

if [ ! -f .env ]; then
  echo "no .env. Copy .env.prod.example and fill it in (see docs/deploy.md)." >&2
  exit 1
fi

# shellcheck disable=SC1091
source .env
: "${API_DOMAIN:?set it in .env}"

echo "==> pulling"
# --ff-only: refuse to deploy a merge commit nobody has seen. If this fails, look at the box's
# checkout before forcing anything.
git pull --ff-only

# Images are tagged with the commit, not `latest`, so that `git checkout <old-sha> && ./deploy.sh`
# actually runs the old binary. Exported because compose interpolates it out of the environment.
IMAGE_TAG="$(git rev-parse HEAD)"
export IMAGE_TAG
echo "==> deploying ${IMAGE_TAG:0:12}"

# The images are built by CI, so a just-pushed commit may not have them yet. Waiting beats failing:
# the alternative is reading a registry 404 and guessing whether it is a build in flight or a
# workflow that never ran.
echo "==> fetching images"
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" pull --quiet 2>/dev/null; then
    break
  fi
  if [ "$i" = 30 ]; then
    echo "no images for ${IMAGE_TAG:0:12} after 5 minutes." >&2
    echo "Check the 'Publish images' workflow for this commit." >&2
    exit 1
  fi
  [ "$i" = 1 ] && echo "    not published yet, waiting for CI"
  sleep 10
done

# Waits for one replica to answer /health, asked from inside the vision container, which is where
# the replicas' ports live. /health only answers once Flyway has migrated, so this waits for ready
# and not merely for listening.
await_replica() {
  local name="$1" port="$2"
  for i in $(seq 1 60); do
    if "${COMPOSE[@]}" exec -T vision python -c \
      "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${port}/health')" 2>/dev/null; then
      echo "    ${name} healthy after ${i}s"
      return 0
    fi
    sleep 1
  done
  echo "==> ${name} never came up. Last 40 lines:" >&2
  "${COMPOSE[@]}" logs --tail 40 "$name" >&2
  return 1
}

# Postgres and the parser first, and note whether the parser container was replaced.
#
# This is the sharpest edge in the whole file. Naming services on `up -d` limits what Compose will
# recreate to those services, so a replaced vision container leaves both replicas holding a network
# namespace that no longer has anything in it. Measured: they keep reporting `running`, Caddy gets
# connection refused on both upstreams, and it never recovers on its own, because nothing about the
# replicas changed and a later `up -d` will not touch them. Compose only handles this when invoked
# for the WHOLE project, which is not what a rolling deploy can do.
echo "==> postgres and vision"
vision_before="$("${COMPOSE[@]}" ps -q vision || true)"
"${COMPOSE[@]}" up -d postgres vision
vision_after="$("${COMPOSE[@]}" ps -q vision || true)"

if [ -n "$vision_before" ] && [ "$vision_before" != "$vision_after" ]; then
  # Both replicas are already stranded by this point, so there is no rolling to be done and nothing
  # to protect. Get them back as fast as possible. This is the one deploy that costs downtime.
  echo "==> the parser was replaced, so both replicas must restart with it (this one has downtime)"
  "${COMPOSE[@]}" up -d --no-deps --force-recreate backend backend-b
  for replica in "${REPLICAS[@]}"; do
    await_replica "${replica%%:*}" "${replica##*:}" || exit 1
  done
  ROLLED=yes
fi

# Sign-in, on its own and before the replicas.
#
# One instance, no rolling, and that is fine: the backend verifies tokens offline against keys it
# cached at startup, so nothing serving the API depends on this being up. The cost of a restart is
# a few seconds in which somebody cannot START a session, not one in which sessions stop working.
echo "==> auth"
"${COMPOSE[@]}" up -d --no-deps auth

# One replica at a time. No --force-recreate: compose leaves a replica alone when nothing about it
# changed, and a deploy that restarts nothing is the correct outcome for a docs-only commit.
for replica in "${REPLICAS[@]}"; do
  [ "${ROLLED:-no}" = yes ] && break
  name="${replica%%:*}"
  port="${replica##*:}"

  echo "==> ${name}"
  "${COMPOSE[@]}" up -d --no-deps "$name"

  if ! await_replica "$name" "$port"; then
    echo "==> the other replica is still serving. Nothing further was restarted." >&2
    exit 1
  fi
done

# Caddy last, and reloaded rather than restarted. The Caddyfile is a bind mount, so compose cannot
# see that it changed and `up -d` would leave the old config running; restarting the container would
# drop live connections for no reason. `caddy reload` swaps the config with neither.
echo "==> caddy"
"${COMPOSE[@]}" up -d --no-deps caddy
"${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

# The real check, made from outside, through Caddy, over TLS, against the actual hostname. A
# container that is "up" proves nothing.
echo "==> waiting for https://${API_DOMAIN}/health"
for i in $(seq 1 60); do
  if curl -sf -o /dev/null --max-time 5 "https://${API_DOMAIN}/health"; then
    echo "==> healthy after ${i}s"
    "${COMPOSE[@]}" ps
    exit 0
  fi
  sleep 1
done

echo "==> NOT healthy after 60s. Last 40 lines:" >&2
"${COMPOSE[@]}" logs --tail 40 backend backend-b auth caddy >&2
exit 1
