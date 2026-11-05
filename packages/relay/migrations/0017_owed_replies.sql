/* ---------- Replies a deleted replies subscription still owed (services/subscriptions.ts, services/feed.ts) ---------- */

-- A channel subscription whose cursor already passed replies to its agent that a since-deleted replies subscription never
-- delivered: those replies after this seq, up to the cursor, come ahead of its next events. NULL when it owes none.
ALTER TABLE subscriptions ADD COLUMN owed_after INTEGER;
