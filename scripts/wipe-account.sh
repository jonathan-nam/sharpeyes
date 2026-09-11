#!/usr/bin/env bash
#
# Erase the test account, so its onboarding can be walked again from the start.
#
#   ./scripts/wipe-account.sh          # says what it would delete, deletes nothing
#   ./scripts/wipe-account.sh --yes    # does it
#
# ONE account, named by WIPE_ACCOUNT_EMAIL in the environment or in ./.env, and any other email is
# refused. The allowed address is configuration and not code on purpose: this repo is public, and a
# real person's email does not go in it. No value set means no account can be wiped, which is the
# right default for a script whose whole job is deleting.
#
# The sender's account is left exactly as it was, minus the acceptance. See wipe-account.sql for the
# order and what it guarantees.
#
# Counts first and counts again after, because "it worked" and "it matched nothing" look identical
# otherwise. Dry by default for the same reason the delete is one transaction: this is run against
# prod, by hand.
#
#   --yes           actually delete. Without it this only prints.
#   --keep-sign-in  leave the auth_user row, so the browser stays signed in on the same id.
#   --force         wipe it even though it has SENT sign-on links, which is what a sender does.
set -euo pipefail

cd "$(dirname "$0")/.."

ASKED=""
CONFIRMED=no
KEEP_SIGN_IN=no
FORCE=no

for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRMED=yes ;;
    --keep-sign-in) KEEP_SIGN_IN=yes ;;
    --force) FORCE=yes ;;
    -*) echo "unknown option: $arg" >&2; exit 1 ;;
    *) ASKED="$arg" ;;
  esac
done

# The environment wins, else the one key out of .env. Read with grep rather than sourced: .env is
# the stack's secrets, and this needs one line of it.
ALLOWED="${WIPE_ACCOUNT_EMAIL:-$(sed -n 's/^WIPE_ACCOUNT_EMAIL=//p' .env 2>/dev/null | tail -1)}"
ALLOWED="${ALLOWED%\"}"
ALLOWED="${ALLOWED#\"}"

if [ -z "$ALLOWED" ]; then
  echo "WIPE_ACCOUNT_EMAIL is not set, so there is no account this may wipe." >&2
  echo "Put the test account's email in .env (it is gitignored):" >&2
  echo "  WIPE_ACCOUNT_EMAIL=someone@example.com" >&2
  exit 1
fi

# A typed address has to agree with the configured one. It is allowed at all so that the command in
# a runbook can say out loud which account it is about.
if [ -n "$ASKED" ] && [ "$ASKED" != "$ALLOWED" ]; then
  echo "$ASKED is not the account this may wipe. WIPE_ACCOUNT_EMAIL names a different one." >&2
  exit 1
fi

EMAIL="$ALLOWED"

PSQL=(docker compose exec -T postgres psql -U sharpeyes -d sharpeyes)

# One line per account the email names, so a wipe that is about to hit two of them says so before
# it does. An id in auth_user with no app row yet is still an account, and still gets a line.
holdings() {
  "${PSQL[@]}" -qtA -v email="$EMAIL" <<'SQL'
WITH ids AS (
    SELECT id FROM users WHERE email = :'email'
    UNION
    SELECT id FROM "auth_user" WHERE email = :'email'
)
SELECT id
    || '  characters=' || (SELECT count(*) FROM characters   WHERE user_id = ids.id)
    || ' parties='     || (SELECT count(*) FROM party        WHERE user_id = ids.id)
    || ' people='      || (SELECT count(*) FROM person       WHERE user_id = ids.id)
    || ' shots='       || (SELECT count(*) FROM screenshots  WHERE user_id = ids.id)
    || ' seats='       || (SELECT count(*) FROM party_member m
                             JOIN characters c ON c.id = m.linked_character_id
                            WHERE c.user_id = ids.id)
    || ' sent-links='  || (SELECT count(*) FROM account_invite WHERE user_id = ids.id)
FROM ids;
SQL
}

BEFORE="$(holdings)"
if [ -z "$BEFORE" ]; then
  echo "no account for $EMAIL" >&2
  exit 1
fi

echo "$EMAIL holds:"
echo "$BEFORE" | sed 's/^/  /'
echo
echo "seats are this account's places in OTHER people's parties. Those seats stay, and go back to"
echo "naming a character nobody has claimed. Nothing of the party owner's is deleted."
echo

if [ "$CONFIRMED" != yes ]; then
  echo "dry run. Add --yes to delete all of the above."
  exit 0
fi

"${PSQL[@]}" -v ON_ERROR_STOP=1 \
  -v email="$EMAIL" -v force="$FORCE" -v keep_sign_in="$KEEP_SIGN_IN" \
  -f - < scripts/wipe-account.sql

echo
AFTER="$(holdings)"
if [ -z "$AFTER" ]; then
  echo "gone."
else
  echo "still there:"
  echo "$AFTER" | sed 's/^/  /'
fi
