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

-- What the relay gave an agent's bot in Discord: the agent's roles (thread_id '') or a place in a private conversation's
-- thread. A row stays until Discord confirms the access is gone, so botsJob takes back whatever a paused, replaced or
-- removed bot still holds, without its token.
CREATE TABLE bot_grants (
  bot_user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (bot_user_id, thread_id)
);

-- The agent's bot that posted the message, or null for the channel's webhook: edits and deletes go the same way. Before it
-- is sent, the bot it was accepted to post as (outside the channel's webhook allowance).
ALTER TABLE relay_messages ADD COLUMN bot_user_id TEXT;
