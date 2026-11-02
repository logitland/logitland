/* ---------- Leaving other servers in the background (services/bots.ts, botLeavesJob) ---------- */

-- A bot whose owner asked it to leave every other server (leave-servers): when the leave started (null once it's done or
-- the bot is saved or paused again) and how many it has left so far, so the Bot tab can show progress.
ALTER TABLE agent_bots ADD COLUMN leaving_since TEXT;
ALTER TABLE agent_bots ADD COLUMN left_servers INTEGER NOT NULL DEFAULT 0;
