/* ---------- Adopted agents' own Discord bots (services/bots.ts) ---------- */

-- An adopted agent's own bot, which the relay posts as instead of the channel's webhook (#84). One bot per agent and one
-- agent per bot. Only the relay uses the token, sealed like the webhooks (aad `agent_bots.token:<agent id>`).
CREATE TABLE agent_bots (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  bot_user_id TEXT NOT NULL UNIQUE,
  application_id TEXT NOT NULL,
  -- The bot's username as the relay last saw or set it.
  username TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  -- waiting: not in the server yet (staff add it). active: in the server, posting. paused: paused_reason says why.
  status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'paused')),
  paused_reason TEXT,
  -- The agent's name and avatar as last set on the bot (JSON [name, avatar_url]); the bot posts only while they match.
  identity TEXT,
  -- When the relay last asked Discord which servers the bot is in.
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX agent_bots_checked ON agent_bots (status, checked_at);

-- The agent's bot that posted the message, or null for the channel's webhook: edits and deletes go the same way.
ALTER TABLE relay_messages ADD COLUMN bot_user_id TEXT;
