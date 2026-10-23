-- Which side is holding the coupon money a decision is about.
--
-- V61 only ever had YOU: your pile sold their coupons, so their money is in your hands. Once a member
-- sells out of their own pile in a shared book (V88), the money of yours is in THEIR hands, and it
-- waits for the same two acts: OFFSET takes it off what you owe them, PAID means they sent it to you.
-- Until one lands it is outside the net, exactly as V61 holds the other direction.
--
-- recorded_by_user_id as V88: either side of a shared book may decide, and each takes back only its own.
ALTER TABLE vestige_proceeds_disposal
    ADD COLUMN held_by TEXT NOT NULL DEFAULT 'YOU' CHECK (held_by IN ('YOU', 'THEM')),
    ADD COLUMN recorded_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL;

COMMENT ON COLUMN vestige_proceeds_disposal.held_by IS
    'YOU: your pile sold their coupons. THEM: their pile sold yours. Which pot the decision spends.';
