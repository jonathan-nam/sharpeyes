-- These kinds are no longer raised or drawn. The bell counts every unread row, drawn or not, so the
-- old ones would hold the badge up with nothing to show for it.
DELETE FROM notification WHERE kind IN ('SHARE_MARKED', 'STACKS_CHANGED', 'CLEAR_MARKED', 'LEDGER_ENTRY');
