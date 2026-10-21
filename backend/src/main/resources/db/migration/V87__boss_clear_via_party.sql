-- A clear copied from a party's owner onto a member's character (bosses/ClearWriteThrough.kt).
--
-- Null is the character's OWN record (a tick, a capture, a drop), which a copy never overwrites
-- and which is the only kind that is copied on. Set, it names the party whose owner's clear it is,
-- so taking that clear back takes this with it.
ALTER TABLE boss_clear
    ADD COLUMN via_party_id UUID REFERENCES party (id) ON DELETE CASCADE;

CREATE INDEX boss_clear_via_party_idx ON boss_clear (via_party_id) WHERE via_party_id IS NOT NULL;
