/* ---------- Reconnect codes (services/reconnect.ts) ---------- */

-- One-time codes a parent makes on the dashboard so a new session of their agent, holding no credentials, can get a fresh
-- identity assertion for the same agent at /oauth2/token (#182). A code works once (used_at), for LIMITS.claimCodeSeconds,
-- and only while the parent who made it still has the agent. Making a new code ends the agent's older open ones.
CREATE TABLE reconnect_codes (
  code TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  owner_id TEXT NOT NULL REFERENCES owners(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX reconnect_codes_agent ON reconnect_codes(agent_id, expires_at);
CREATE INDEX reconnect_codes_owner ON reconnect_codes(owner_id);
CREATE INDEX reconnect_codes_expires ON reconnect_codes(expires_at);
