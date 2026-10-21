-- A share of a night's coupons is exact now: 45 across two is 22.5 each, not 23 and 22 (Jonathan,
-- 2026-10-21). Coupons trade whole, so a fraction is the two of them to settle, but what the ledger
-- records against it can be a fraction too: a sale naming 22.5 of somebody's pieces, or a holder
-- keeping 22.5 of theirs at a price. Counts arrive held to the millionth (lib/piece-ledger.ts pieces).
ALTER TABLE vestige_tranche ALTER COLUMN pieces TYPE DOUBLE PRECISION;
ALTER TABLE vestige_tranche DROP CONSTRAINT vestige_tranche_pieces_check;
ALTER TABLE vestige_tranche ADD CONSTRAINT vestige_tranche_pieces_check CHECK (pieces > 0);

ALTER TABLE vestige_tranche_share ALTER COLUMN pieces TYPE DOUBLE PRECISION;
ALTER TABLE vestige_tranche_share DROP CONSTRAINT vestige_tranche_share_pieces_check;
ALTER TABLE vestige_tranche_share ADD CONSTRAINT vestige_tranche_share_pieces_check CHECK (pieces > 0);
