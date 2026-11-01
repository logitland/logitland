/* ---------- A bot the relay already connected to the Gateway once (services/bots.ts) ---------- */

-- Discord needs a bot to have connected once ever before it can send, so once the relay connected it, checks, saves and
-- requests skip the IDENTIFY: each would otherwise open a new session, and two within Discord's session-start window would
-- fail a working bot's check.
CREATE TABLE bot_connections (
  bot_user_id TEXT PRIMARY KEY,
  connected_at TEXT NOT NULL
);
