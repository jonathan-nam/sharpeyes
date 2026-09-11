-- Erase the test account, so its onboarding can be walked again from the start.
--
--   ./scripts/wipe-account.sh --yes
--
-- Which account that is comes from WIPE_ACCOUNT_EMAIL, and the shell script refuses every other
-- address. This file will delete whatever email it is handed, so it is not the guard.
--
-- For the second account a sign-on link is tested with. What it leaves behind is the SENDER's
-- account exactly as it was, minus the fact of the acceptance: the seats that named the wiped
-- account's characters go back to naming nobody (party_member.linked_character_id is ON DELETE SET
-- NULL, V75), and the person row that pointed at it stops being linked (person.linked_user_id, V70).
-- The sender's pool, weeks and payouts are never touched, because none of them hang off the
-- recipient.
--
-- The order below is the FK graph, not a guess. Five tables reference users(id) with NO ACTION
-- (characters, party, person, person_character, screenshots), so they go first; everything else is
-- CASCADE off one of those or off users itself. That is also the safety net: a table added later
-- that this forgets will either take its rows with it (CASCADE, which is what we want for an
-- account's own data) or refuse the final DELETE, which is loud. It cannot report success and leave
-- half the account behind.

\set ON_ERROR_STOP on

BEGIN;

-- Through session settings, as reassign-user.sql does: psql does not substitute :'vars' inside a
-- dollar-quoted body, and the failure is a syntax error rather than an empty value.
\o /dev/null
SELECT set_config('wipe.email', :'email', true);
SELECT set_config('wipe.force', :'force', true);
SELECT set_config('wipe.keep_sign_in', :'keep_sign_in', true);
\o

DO $$
DECLARE
    target  TEXT := current_setting('wipe.email');
    force   BOOLEAN := current_setting('wipe.force') = 'yes';
    keep    BOOLEAN := current_setting('wipe.keep_sign_in') = 'yes';
    ids     TEXT[];
    sent    BIGINT;
    n       BIGINT;
BEGIN
    -- Both tables, because an account can exist in either alone: signing in writes auth_user, and
    -- the app row is not written until the first API call (ensureUser). A wipe that read only one
    -- of them would leave the other behind and the next sign-in would land on it.
    SELECT array_agg(DISTINCT id) INTO ids FROM (
        SELECT id FROM users WHERE email = target
        UNION
        SELECT id FROM "auth_user" WHERE email = target
    ) AS found;

    IF ids IS NULL THEN
        RAISE EXCEPTION 'no account for %', target;
    END IF;
    RAISE NOTICE 'wiping % (% id(s))', target, array_length(ids, 1);

    -- An account that has SENT a sign-on link is somebody's sender, which is the account this
    -- script exists to protect rather than delete. Overridable, because "I sent one from the test
    -- account" is a real thing to have done.
    SELECT count(*) INTO sent FROM account_invite WHERE user_id = ANY(ids);
    IF sent > 0 AND NOT force THEN
        RAISE EXCEPTION 'that account has sent % sign-on link(s), so it is somebody''s sender. --force to wipe it anyway', sent;
    END IF;

    -- Before users, not after: accepted_by is ON DELETE SET NULL, so deleting the account first
    -- would leave a spent link on the sender's list with nothing saying who spent it. A wipe is
    -- the acceptance being undone, so the row it produced goes with it.
    DELETE FROM account_invite WHERE accepted_by = ANY(ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '  spent links       : %', n;

    SELECT count(*) INTO n FROM person WHERE linked_user_id = ANY(ids);
    RAISE NOTICE '  links to clear    : % (on other accounts, cleared by the delete below)', n;

    DELETE FROM party WHERE user_id = ANY(ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '  parties           : %', n;

    -- Unbinds this account's seats in OTHER people's parties on the way out, which is the seat
    -- going back to naming a character nobody has claimed.
    DELETE FROM characters WHERE user_id = ANY(ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '  characters        : %', n;

    DELETE FROM person_character WHERE user_id = ANY(ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '  person characters : %', n;

    DELETE FROM person WHERE user_id = ANY(ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '  people            : %', n;

    DELETE FROM screenshots WHERE user_id = ANY(ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '  screenshots       : %', n;

    DELETE FROM users WHERE id = ANY(ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '  accounts          : %', n;

    -- The sign-in itself. Kept only when asked for: leaving it means the next sign-in returns to
    -- the same user id with an empty account, which tests the app's onboarding but not Discord's
    -- half of it. Dropping it signs the browser out (auth_session is CASCADE) and the next sign-in
    -- mints a new id, which is what a new person actually gets.
    IF keep THEN
        RAISE NOTICE '  sign-in           : kept';
    ELSE
        DELETE FROM "auth_user" WHERE id = ANY(ids) OR email = target;
        GET DIAGNOSTICS n = ROW_COUNT;
        RAISE NOTICE '  sign-in           : % row(s) deleted', n;
    END IF;
END $$;

COMMIT;
