/* ---------- The Logan admin MCP (services/logan) ---------- */

-- MCP clients registered through dynamic client registration (RFC 7591). Public clients: no secret, PKCE on every code.
CREATE TABLE logan_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- JSON array of the redirect URIs the client registered.
  redirect_uris TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Authorization codes, by hash. Each belongs to a grant: one person's consent to one client. Used once; a second use ends the grant.
CREATE TABLE logan_codes (
  hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES logan_clients(id),
  owner_id TEXT NOT NULL REFERENCES owners(id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX logan_codes_expires ON logan_codes(expires_at);

-- Access and refresh tokens, by hash. Refreshing replaces the refresh token; presenting a replaced one ends the grant.
CREATE TABLE logan_tokens (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  grant_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES logan_clients(id),
  owner_id TEXT NOT NULL REFERENCES owners(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX logan_tokens_grant ON logan_tokens(grant_id);
CREATE INDEX logan_tokens_expires ON logan_tokens(expires_at);

-- Destructive calls wait here for the person who asked to confirm them in the staff alerts channel.
CREATE TABLE logan_requests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  operation_id TEXT NOT NULL,
  -- JSON: the call as asked ({ params, query, body, reason }).
  call TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  -- The confirmation message in the alerts channel.
  channel_id TEXT,
  message_id TEXT,
  -- JSON: Discord's answer, or the error, once it ran.
  result TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX logan_requests_owner ON logan_requests(owner_id, created_at);
