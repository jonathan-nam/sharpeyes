-- Which of the sender's people a friend request is for, when it was sent from that person's row on
-- People. Accepting links that person instead of guessing one (FriendLinks.kt linkSide). NULL is a
-- request from Social, which still guesses.
ALTER TABLE friend_request
    ADD COLUMN person_id UUID REFERENCES person (id) ON DELETE SET NULL;

-- One waiting request per person: asking a second account replaces the first.
CREATE UNIQUE INDEX friend_request_person_idx ON friend_request (person_id);
