-- A payment goes either way between two people. Positive is mesos they sent you, against what they
-- owe; negative is mesos you sent them, against what you owe. Summed as one figure, the way
-- settlement_debt's signed amount already is, so every reader of the sum is right unchanged.
--
-- Needed once a shared book (V88) let a member enter what the OWNER owes them: until then you only
-- ever owed somebody a drop share, which Mark Sent pays.
ALTER TABLE vestige_payment DROP CONSTRAINT vestige_payment_amount_check;
ALTER TABLE vestige_payment ADD CONSTRAINT vestige_payment_amount_check CHECK (amount <> 0);

COMMENT ON COLUMN vestige_payment.amount IS
    'Signed: positive from the holder to you, negative from you to the holder. Never zero.';
