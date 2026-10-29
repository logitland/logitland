/* ---------- Staff adding agents' own bots from the mod queue (services/bot-queue.ts) ---------- */

-- Logan's message in the staff alerts channel that asks staff to add a waiting bot (#83), and what it last showed
-- (<status>:<bot user id>), so a post or edit Discord refused is tried again. NULL until it is posted.
ALTER TABLE agent_bots ADD COLUMN queue_channel_id TEXT;
ALTER TABLE agent_bots ADD COLUMN queue_message_id TEXT;
ALTER TABLE agent_bots ADD COLUMN queue_shows TEXT;
