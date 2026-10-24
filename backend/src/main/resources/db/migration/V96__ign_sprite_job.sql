-- The job Nexon gives for a typed IGN, beside its sprite (V95).
--
-- The Party Planner needs a character's job (two Lynns never share a party), and a character filed
-- under a person who does not use the app has no account to say it. Nexon's lookup already answers
-- with the job; it was thrown away. Null for a miss, and for rows recorded before this column, which
-- are asked again so the job fills in.
ALTER TABLE ign_sprite ADD COLUMN job_name TEXT;
