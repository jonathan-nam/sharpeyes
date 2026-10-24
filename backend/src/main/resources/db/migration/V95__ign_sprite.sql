-- What Nexon said about a typed IGN, one row per name, shared by every account.
--
-- Until now an IGN only got a sprite as a side effect of a party save, and only on that seat, so a
-- character filed under a person but in no party drew an empty frame. This is the one place any
-- typed name is looked up. Account-free because the answer is public ranking data and identical for
-- everyone who types the name.
--
-- sprite_img_url is null for a name Nexon did not find; looked_up_at is when to ask again.
CREATE TABLE ign_sprite (
    name_key       TEXT PRIMARY KEY,
    name           TEXT        NOT NULL,
    sprite_img_url TEXT,
    looked_up_at   TIMESTAMPTZ NOT NULL
);
