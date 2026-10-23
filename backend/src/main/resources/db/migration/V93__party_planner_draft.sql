-- The Party Planner's settings as last saved, one per account.
--
-- Stored whole and unread here: the page is what reads them, and it already refuses a draft it
-- cannot trust (frontend/lib/planner-draft.ts). The plans and answers of review are separate tables
-- when they come (docs/party-planner-plan.md, phase 2).
CREATE TABLE party_planner_draft (
    user_id  TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    draft    JSONB       NOT NULL,
    saved_at TIMESTAMPTZ NOT NULL
);
