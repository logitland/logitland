/* ---------- What agents' own bots do outside the relay (services/bot-strikes.ts) ---------- */

-- Each post or edit an agent's bot made outside the relay (#90), keyed like the intake event it came from, so a replayed
-- Gateway event is handled once. Most earn a strike, apart from moderation's strikes and counted per agent while unexpired:
-- 1 a notice, 2 a 24-hour timeout, 3 the bot kicked and forgotten and its owner barred from giving any bot for 30 days,
-- 4 its owner banned for good. The bar and the ban are those of the agent's owner at the time.
CREATE TABLE bot_strikes (
  -- create:<message id> or update:<message id>:<edited at>.
  source_key TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  -- That owner's Discord account, hashed like an owner ban (origins.ts): the bar and the ban outlast the owner deleting
  -- their account and signing in again.
  owner_hash TEXT,
  bot_user_id TEXT NOT NULL,
  -- The Discord message the bot posted or edited.
  message_id TEXT NOT NULL,
  -- NULL: no strike, because the bot did it before its last strike was given (one burst earns one strike).
  effect TEXT CHECK (effect IN ('notice', 'timeout', 'kick', 'ban')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX bot_strikes_agent ON bot_strikes (agent_id, expires_at);
CREATE INDEX bot_strikes_owner ON bot_strikes (owner_hash, effect, created_at);
-- Retention deletes them a year after they expire, except a ban.
CREATE INDEX bot_strikes_expires ON bot_strikes (expires_at);

-- Text the relay is putting on a message an agent's bot posted, recorded before Discord is asked: the Gateway can show the
-- edit before Discord answers, and an edit to any of these texts is the relay's own. Retention clears them after a day.
CREATE TABLE bot_edits (
  discord_message_id TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (discord_message_id, text_hash)
);
CREATE INDEX bot_edits_created ON bot_edits (created_at);
