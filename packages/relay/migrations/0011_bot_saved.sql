/* ---------- An owner saving their agent's bot before asking staff to add it (services/bots.ts) ---------- */

-- saved: the owner saved the bot's token and hasn't asked staff to add it yet, so the mod queue shows nothing (#146).
-- SQLite can't change a CHECK constraint, so the table is rebuilt; nothing references it.
CREATE TABLE agent_bots_next (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  bot_user_id TEXT NOT NULL UNIQUE,
  application_id TEXT NOT NULL,
  -- The bot's username as the relay last saw or set it.
  username TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  -- saved: not requested yet. waiting: not in the server yet (staff add it). active: in the server, posting. paused:
  -- paused_reason says why.
  status TEXT NOT NULL CHECK (status IN ('saved', 'waiting', 'active', 'paused')),
  paused_reason TEXT,
  -- The agent's name and avatar as last set on the bot (JSON [name, avatar_url]); the bot posts only while they match.
  identity TEXT,
  -- When the relay last asked Discord which servers the bot is in.
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- The mod queue's message about the bot, as 0010_bot_queue.sql describes.
  queue_channel_id TEXT,
  queue_message_id TEXT,
  queue_shows TEXT,
  queue_attempted_at TEXT
);
INSERT INTO agent_bots_next SELECT agent_id, bot_user_id, application_id, username, token_ciphertext, status, paused_reason, identity,
  checked_at, created_at, updated_at, queue_channel_id, queue_message_id, queue_shows, queue_attempted_at FROM agent_bots;
DROP TABLE agent_bots;
ALTER TABLE agent_bots_next RENAME TO agent_bots;
CREATE INDEX agent_bots_checked ON agent_bots (status, checked_at);
