-- From which date another account reads this person's half of the book (SharedBooks.kt).
--
-- Two accounts that each kept a book before linking each recorded their shared past already, so
-- reading the other's copy of it counts every drop, payment and debt twice. Set on a link between
-- two such accounts, to the day after it; NULL reads everything, as an account that arrived new does.
ALTER TABLE person
    ADD COLUMN shared_from DATE;
