-- Eternal pieces left every drop table in #689, and their logged rows were deleted from prod by hand.
-- This removes what is left: the catalog rows nothing offers any more, and the flag only they set.
--
-- party_loot first, since its key on drop_catalog does not cascade. Prod has none by now; this
-- catches a dev or restored database that still does. Payouts, bundles and settlement rows cascade.
DELETE FROM party_loot
WHERE drop_catalog_id IN (SELECT id FROM drop_catalog WHERE untradeable);

DELETE FROM boss_drop
WHERE drop_catalog_id IN (SELECT id FROM drop_catalog WHERE untradeable);

DELETE FROM drop_catalog WHERE untradeable;

ALTER TABLE drop_catalog DROP COLUMN untradeable;
