-- Who wrote each Settlement ledger row. Between two linked accounts the book is shared: the member
-- adds debts, payments and coupon sales into the owner's book (parties/SharedBookWrites.kt), so a row
-- has to say whose it is. Each side removes only its own, and the card names the other side's.
--
-- Null is the book's owner, which is every row written before this.
ALTER TABLE vestige_tranche ADD COLUMN recorded_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE settlement_debt ADD COLUMN recorded_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE vestige_payment ADD COLUMN recorded_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL;
