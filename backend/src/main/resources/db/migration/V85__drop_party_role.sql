-- Every member who has joined a party may now log drops and record sales, so there is no role left
-- to store. V83's table goes with it. A member still acts only as their own seats; see
-- parties/PartyAccess.kt.

DROP TABLE party_role;
