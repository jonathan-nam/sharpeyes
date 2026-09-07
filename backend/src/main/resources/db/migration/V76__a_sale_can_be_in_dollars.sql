-- A drop sold for real money, in cents, beside the meso price rather than inside it.
--
-- A SEPARATE COLUMN, not a currency flag on sale_amount. A flag would leave every existing reader
-- of sale_amount type-correct and wrong: 100000 cents read as 100k mesos is a plausible confident
-- number, which is the failure this schema exists to refuse. Null here and null there cannot be
-- confused, so a reader that has not been taught about dollars gets "no price" and declines to
-- split, which is the outcome we want from it.
--
-- Exactly one of the two, and only on a sold row. Both would be two answers to what it fetched.
ALTER TABLE party_loot
    ADD COLUMN sale_usd_cents BIGINT;

ALTER TABLE party_loot DROP CONSTRAINT party_loot_sale_complete;
ALTER TABLE party_loot
    ADD CONSTRAINT party_loot_sale_complete CHECK (
        (sold_at IS NULL AND sale_amount IS NULL AND sale_usd_cents IS NULL
             AND amount_basis IS NULL AND split_method IS NULL
             AND seller_member_id IS NULL AND seller_shares IS NULL)
        OR (sold_at IS NOT NULL AND amount_basis IS NOT NULL
             AND split_method IS NOT NULL AND seller_member_id IS NOT NULL
             AND seller_shares IS NOT NULL
             AND (sale_amount IS NOT NULL) <> (sale_usd_cents IS NOT NULL))
    );

-- Zero dollars is not a real money sale, it is an unpriced one.
--
-- The ceiling is a billion dollars, which is not a sanity bound on the item but on the arithmetic:
-- the split runs in the browser, where an integer stops being exact past 2^53, and a share is this
-- times a share count of up to 99. Mesos carry no such cap, and should: see saleRefusal.
ALTER TABLE party_loot
    ADD CONSTRAINT party_loot_usd_above_zero CHECK (
        sale_usd_cents IS NULL OR (sale_usd_cents > 0 AND sale_usd_cents <= 100000000000)
    );

-- LISTED is "what the Auction House had it up for", and it is the one basis that takes a cut off
-- the top. Real money never crossed the Auction House, so a dollar sale on that basis would shave
-- 5% off a pot nobody taxed. RECEIVED and BOUGHT both mean "this is the whole pot", which is what
-- a dollar figure always is.
ALTER TABLE party_loot
    ADD CONSTRAINT party_loot_usd_is_not_listed CHECK (
        sale_usd_cents IS NULL OR amount_basis <> 'LISTED'
    );
