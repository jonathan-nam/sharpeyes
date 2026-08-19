#!/usr/bin/env bash
#
# Boots the local stack: postgres, vision and backend via compose, plus the Next dev server.
# Run by the SessionStart hook in .claude/settings.json, and safe to run by hand.
#
# Two rules it must obey, because it runs unattended on every session:
#
#   Idempotent. `docker compose up -d` is a no-op on a running stack, and the dev server is only
#   started when nothing already answers on 3000. Starting a second one would bind-fail and leave
#   a confusing log.
#
#   Never fatal. A session has to start even when Docker is down or .env is missing. Every failure
#   here is reported and swallowed, never propagated.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 0

status=()

# Compose deliberately refuses to start without AUTH_SECRET and the Discord credentials (see
# docker-compose.yml), so a missing .env would fail every time. Say so once rather than failing on
# every session.
if [ ! -f .env ]; then
  echo '{"systemMessage":"Local stack not started: .env is missing, and compose refuses to start without AUTH_SECRET and DISCORD_CLIENT_ID/SECRET. See .devcontainer/README.md."}'
  exit 0
fi

# Both files, always. docker-compose.dev.yml adds hot reload to vision and is not auto-loaded, so
# a bare `docker compose up` and smoke.sh keep running the production image. Cost of the two
# configs: whichever ran last recreates the vision and backend containers, a few seconds.
if docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d >/tmp/compose-up.log 2>&1; then
  status+=("postgres/vision/backend up")
else
  status+=("compose FAILED (see /tmp/compose-up.log)")
fi

# Is the PORT bound, not "does HTTP answer". A dev server busy recompiling holds 3000 but can take
# many seconds to reply, and an HTTP probe with any tolerable timeout reads that as "nothing there"
# and starts a second server. It does not check a pidfile either: a stale one outlives the process
# and would skip the start forever.
if (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null; then
  status+=("frontend already on :3000")
else
  (cd frontend && nohup pnpm run dev >/tmp/next.log 2>&1 &) >/dev/null 2>&1
  status+=("frontend starting on :3000 (/tmp/next.log)")
fi

printf '{"systemMessage":"MapleStorage: %s."}\n' "$(
  IFS=';'
  echo "${status[*]}" | sed 's/;/, /g'
)"
