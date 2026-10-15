-- When this config's standing roster started answering, as a party, for weeks nobody wrote down.
-- A config changes kind in place (solo pool adopted, retired one revived, one-off made standing),
-- so created_at overstates it, and a past week read off today's roster would claim a party that was
-- not there. Weeks with their own roster (party_week_seat) do not need it. See ranAsPartyIn.
--
-- Backfilled from created_at, which is right for every config that has never changed kind and too
-- early for one that has. Nothing recorded the earlier transitions.
ALTER TABLE party ADD COLUMN party_since TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE party SET party_since = created_at;
