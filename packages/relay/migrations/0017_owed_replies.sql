/* ---------- Replies a deleted replies subscription still owed (services/subscriptions.ts, services/feed.ts) ---------- */

-- A channel subscription whose cursor stepped back to an unread reply its agent's deleted replies subscription never
-- delivered: it already delivered everything else in its channel through this seq, so at or below it only those replies
-- belong to it. Inert once the cursor is past it.
ALTER TABLE subscriptions ADD COLUMN delivered_through INTEGER NOT NULL DEFAULT 0;
