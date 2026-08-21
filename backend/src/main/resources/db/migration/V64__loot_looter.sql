-- Who picked up a drop that is one thing.
--
-- Until now the holder of an indivisible drop was recorded nowhere until it SOLD, and seller_member_id
-- arrives with the sale, which is the thing a member who does not loot is waiting on. So their Drop
-- Log listed items with a stage and no holder: nothing on screen said who to ask. That reading is
-- what this column is for.
--
-- NOT for a drop that divides. party_loot_bundle (V41) already says which seat picked up how many
-- stacks, and one seat id cannot say "two of the three". A second, coarser answer to a question that
-- already has an exact one is two places to disagree.
--
-- Not enforced here, and deliberately: deciding whether a drop divides needs the party's mode and
-- world against the catalog, which is a read this constraint cannot do. The form does not offer the
-- question on a divisible drop and the log reads the stacks there, so a value written past both by
-- an API caller is unread rather than believed. See lib/drop-log.ts, `lootedBy`.
--
-- Absent means nobody said, never "the config's usual looter". party.looter_member_id (V36) is a
-- standing arrangement and seeds the form; what lands here is what somebody confirmed. Same rule V41
-- states for bundles: suggest it on screen, store what was actually done.
--
-- SET NULL rather than CASCADE, as V36. A seat leaving the party does not unmake the night it ran.
ALTER TABLE party_loot
    ADD COLUMN looter_member_id UUID REFERENCES party_member(id) ON DELETE SET NULL;

COMMENT ON COLUMN party_loot.looter_member_id IS
    'Which seat picked this drop up. NULL is nobody having said, and is always NULL on a divisible drop.';
