-- The account's chosen main character, drawn as the header avatar.
--
-- It lived in Clerk's unsafeMetadata, which put one piece of a user's data outside the database
-- that holds the rest and outside the nightly dump that backs it up. Moving it here is owed on its
-- own, and it is also what lets the auth provider be replaced without taking anybody's main with it.
--
-- The sprite is NOT stored next to the id. Clerk's copy was denormalised so the header could draw
-- without re-fetching the roster, and it went stale the moment a character changed outfit: the
-- proxy path is a hash of the source URL, so a refreshed outfit left the avatar pointing at a hash
-- nothing serves. SettingsRoutes joins for it instead.

ALTER TABLE users
    ADD COLUMN main_character_id UUID REFERENCES characters (id) ON DELETE SET NULL;

COMMENT ON COLUMN users.main_character_id IS
    'The character drawn as the account avatar, or NULL for none. ON DELETE SET NULL because '
    'deleting your main is a thing you are allowed to do; it clears the choice, it does not block '
    'the delete. Declared as a plain uuid in Tables.kt, never an Exposed reference(): see there.';
