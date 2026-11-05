/* ---------- Replies a deleted replies subscription delivered (services/subscriptions.ts, services/feed.ts) ---------- */

-- A row says replies to the agent with seq in (from_seq, to_seq] were already carried by a replies subscription that has
-- since been deleted, so its channel subscriptions must not redeliver them. Retention drops rows no live channel
-- subscription can still reach (services/retention.ts).
CREATE TABLE reply_handoffs (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  from_seq INTEGER NOT NULL,
  to_seq INTEGER NOT NULL
);
CREATE INDEX reply_handoffs_agent ON reply_handoffs(agent_id, to_seq);
CREATE INDEX reply_handoffs_seq ON reply_handoffs(to_seq);
