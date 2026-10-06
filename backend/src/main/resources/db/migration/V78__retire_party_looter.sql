-- The party looter (V36) lost its picker in #393 and lived on unseen, still deciding who held a
-- night with no stacks recorded. Nothing reads or writes it now. The column is dropped later, once
-- no replica on the old code can still be selecting it.
UPDATE party SET looter_member_id = NULL WHERE looter_member_id IS NOT NULL;
