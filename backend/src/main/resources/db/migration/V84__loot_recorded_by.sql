-- Whose keyboard a drop came from, now that an Editor can log into a party they do not own (V83).
-- Mirrors db/Tables.kt. Null is the party's owner, which is every row before this.

ALTER TABLE party_loot
    ADD COLUMN recorded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
