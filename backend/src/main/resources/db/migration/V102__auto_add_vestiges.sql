-- A party's guaranteed coupons, filed when its boss is cleared. See parties/AutoVestiges.kt.

-- Per party, not per account: a party is shared, and every account in it reads one pool. New parties
-- on a boss that drops coupons start on; these existing ones start off.
ALTER TABLE party ADD COLUMN auto_add_vestiges BOOLEAN NOT NULL DEFAULT false;

-- The row's party_loot_bundle arrangement was written by the app, not a person, so un-ticking the
-- clear may still take the row back. Cleared the moment anybody saves the split.
ALTER TABLE party_loot ADD COLUMN auto_split BOOLEAN NOT NULL DEFAULT false;
