/* ---------- Staff adding agents' own bots from the mod queue (services/bot-queue.ts) ---------- */

-- Logan's message in the staff alerts channel that asks staff to add a waiting bot (#83), and what it last showed
-- (<status>:<bot user id>), so a post or edit Discord refused is tried again. NULL until it is posted, and again once staff
-- delete it.
ALTER TABLE agent_bots ADD COLUMN queue_channel_id TEXT;
ALTER TABLE agent_bots ADD COLUMN queue_message_id TEXT;
ALTER TABLE agent_bots ADD COLUMN queue_shows TEXT;
-- When botsJob last tried the message again; it tries those last, so a few that keep failing can't hold up the rest.
ALTER TABLE agent_bots ADD COLUMN queue_attempted_at TEXT;

-- An open message whose bot was removed, kept with its last text until Discord takes that edit: the bot's row is gone.
CREATE TABLE bot_queue_closings (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  -- When the edit was last tried.
  attempted_at TEXT NOT NULL
);
