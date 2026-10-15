-- A character seated in a standing party runs its boss, so a "doesn't run" mark on that pair is
-- wrong. Only the lead's mark used to be cleared, which left a member seat and the routine
-- disagreeing. The same rule clearSkipsOfSeats keeps from here on.
DELETE FROM character_boss_skip s
USING party p, party_member m
WHERE m.party_id = p.id
  AND p.boss_catalog_id = s.boss_catalog_id
  AND s.character_id IN (m.character_id, m.linked_character_id)
  AND m.standing
  AND p.standing
  AND NOT p.solo
  AND NOT p.one_off;
