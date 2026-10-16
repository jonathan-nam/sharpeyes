-- The mode a party ran its boss at in one period, when that was not its usual one: Chaos Kalos run
-- on Normal for a week a member was away. Mirrors db/Tables.kt.
--
-- Filed by the boss's own period like party_period_skip, and like it the absence of a row is the
-- answer: no row is the config's own difficulty, so next period reverts without being told to.

CREATE TABLE party_period_difficulty (
    party_id     UUID NOT NULL REFERENCES party(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    difficulty   TEXT NOT NULL CHECK (difficulty IN ('EASY', 'NORMAL', 'HARD', 'CHAOS', 'EXTREME')),
    PRIMARY KEY (party_id, period_start)
);
