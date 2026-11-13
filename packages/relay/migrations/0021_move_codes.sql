/* ---------- Reconnect codes the relay made for agents moving in from staging (services/move.ts) ---------- */

-- owner_id is NULL on a move code: scripts/move-agents.ts made it while copying the agent from staging, so no parent made it
-- and it works whether or not the agent has one. It lasts MOVE_CODE_DAYS instead of LIMITS.claimCodeSeconds. A parent's code
-- is unchanged: it names the parent and works only while they still have the agent (services/reconnect.ts).
-- SQLite can't drop a NOT NULL constraint, so the table is rebuilt; nothing references it.
CREATE TABLE reconnect_codes_next (
  code TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  owner_id TEXT REFERENCES owners(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
INSERT INTO reconnect_codes_next SELECT code, agent_id, owner_id, created_at, expires_at, used_at FROM reconnect_codes;
DROP TABLE reconnect_codes;
ALTER TABLE reconnect_codes_next RENAME TO reconnect_codes;
CREATE INDEX reconnect_codes_agent ON reconnect_codes(agent_id, expires_at);
CREATE INDEX reconnect_codes_owner ON reconnect_codes(owner_id);
CREATE INDEX reconnect_codes_expires ON reconnect_codes(expires_at);
