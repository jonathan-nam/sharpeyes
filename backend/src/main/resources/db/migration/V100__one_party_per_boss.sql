-- A character clears a boss once a period, every difficulty sharing the one clear, so it may hold one
-- standing party per boss. The app refuses the clash where it is written (validateBossRoster,
-- inPartyFor, CombineSeats.kt); this is the backstop that refuses it at commit if a path forgets.
--
-- Live parties only: standing, not solo, not a one-off, and standing seats in them. A one-off is a
-- night and a solo pool is not a party, and the app rules for both read the period, which a
-- constraint cannot. Checked for the party written and only what it holds, so a clash elsewhere in
-- the table cannot block an unrelated write.
--
-- Two rules, as the app has them:
--   - a CHARACTER (as a party's own, or a seat linked to another account's) holds one live party per
--     boss, across every account. Not a seat's own character_id: writeMembers resolves it by name
--     across worlds, so two same-named characters can share one, and the name rule covers those seats;
--   - a seat NAME holds one live party per boss within one account and one world (a party's world is
--     its own character's). A name is only unique within a world. Seats name people who may have no
--     account, and two accounts naming one before they combine are two books, not one clash.
CREATE FUNCTION check_one_party_per_boss(p_party UUID) RETURNS void
    LANGUAGE plpgsql AS
$$
DECLARE
    v_owner TEXT;
    v_boss  UUID;
    v_world TEXT;
    v_clash TEXT;
BEGIN
    SELECT p.user_id, p.boss_catalog_id, c.world_type
    INTO v_owner, v_boss, v_world
    FROM party p
             JOIN characters c ON c.id = p.character_id
    WHERE p.id = p_party AND p.standing AND NOT p.solo AND NOT p.one_off;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT c.name
    INTO v_clash
    FROM (SELECT character_id AS who FROM party WHERE id = p_party
          UNION
          SELECT linked_character_id FROM party_member
          WHERE party_id = p_party AND standing AND linked_character_id IS NOT NULL) mine
             JOIN (SELECT o.character_id AS who FROM party o
                   WHERE o.id <> p_party AND o.boss_catalog_id = v_boss
                     AND o.standing AND NOT o.solo AND NOT o.one_off
                   UNION
                   SELECT m.linked_character_id FROM party_member m
                            JOIN party o ON o.id = m.party_id
                   WHERE o.id <> p_party AND o.boss_catalog_id = v_boss
                     AND o.standing AND NOT o.solo AND NOT o.one_off AND m.standing
                     AND m.linked_character_id IS NOT NULL) others
                  ON others.who = mine.who
             JOIN characters c ON c.id = mine.who
    LIMIT 1;
    IF v_clash IS NOT NULL THEN
        RAISE EXCEPTION '% is already in another party for this boss', v_clash
            USING ERRCODE = 'unique_violation';
    END IF;

    SELECT m.name
    INTO v_clash
    FROM party_member m
             JOIN party_member om ON lower(om.name) = lower(m.name) AND om.standing
             JOIN party o ON o.id = om.party_id
             JOIN characters oc ON oc.id = o.character_id
    WHERE m.party_id = p_party AND m.standing
      AND o.id <> p_party AND o.user_id = v_owner AND o.boss_catalog_id = v_boss
      AND oc.world_type = v_world
      AND o.standing AND NOT o.solo AND NOT o.one_off
    LIMIT 1;
    IF v_clash IS NOT NULL THEN
        RAISE EXCEPTION '% is already in another party for this boss', v_clash
            USING ERRCODE = 'unique_violation';
    END IF;
END;
$$;

CREATE FUNCTION one_party_per_boss_party() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    PERFORM check_one_party_per_boss(NEW.id);
    RETURN NULL;
END;
$$;

CREATE FUNCTION one_party_per_boss_seat() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    PERFORM check_one_party_per_boss(NEW.party_id);
    RETURN NULL;
END;
$$;

-- Deferred to commit: a roster rewrite and a combine both pass through states that are only whole
-- once every row of the transaction has landed.
CREATE CONSTRAINT TRIGGER one_party_per_boss
    AFTER INSERT OR UPDATE ON party
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
EXECUTE FUNCTION one_party_per_boss_party();

CREATE CONSTRAINT TRIGGER one_party_per_boss
    AFTER INSERT OR UPDATE ON party_member
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
EXECUTE FUNCTION one_party_per_boss_seat();
