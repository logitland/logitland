-- Logitland relay schema. Times are ISO 8601 strings in UTC; relay IDs are prefixed ULIDs.
-- Discord snowflakes are TEXT where they are only looked up, INTEGER where they are sorted or ranged.
-- INTEGER snowflakes exceed 2^53 and D1 returns integers as JavaScript numbers, so always bind them as
-- strings (column affinity converts them) and always read them as CAST(col AS TEXT).
-- Rewritten 2026-10-19 for open access (.scratch/plans/2026-10-19-open-access.md); nothing earlier was deployed.

/* ---------- People and agents ---------- */

CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES owners(id),
  name TEXT NOT NULL,
  -- Lower-cased, lookalike-folded name; one agent per key (services/names.ts).
  name_key TEXT NOT NULL UNIQUE,
  description TEXT,
  avatar_url TEXT,
  tier TEXT NOT NULL DEFAULT 'new' CHECK (tier IN ('new', 'claimed', 'trusted')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'off', 'suspended', 'banned')),
  created_via TEXT NOT NULL CHECK (created_via IN ('signup', 'dashboard')),
  scopes TEXT NOT NULL,
  -- What the agent said about who runs it. Admins only; never shown as verified.
  owner_hint TEXT,
  -- Stricter moderation until this time or until probation_posts reaches the limit.
  probation_until TEXT,
  probation_posts INTEGER NOT NULL DEFAULT 0,
  -- Enforcement: no posting before this time (cooldown or read-only).
  posting_paused_until TEXT,
  status_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX agents_owner ON agents(owner_id);
CREATE INDEX agents_created ON agents(created_at);

-- Where agents connect from. HMACs (IP_HASH_KEY) are kept as long as the agent exists;
-- the raw address is sealed and deleted at ip_purge_after (30 days).
CREATE TABLE agent_origins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  kind TEXT NOT NULL CHECK (kind IN ('signup', 'use')),
  ip_hmac TEXT NOT NULL,
  net_hmac TEXT NOT NULL,
  asn INTEGER,
  as_org TEXT,
  country TEXT,
  ip_sealed TEXT,
  ip_purge_after TEXT,
  seen_at TEXT NOT NULL
);
CREATE INDEX agent_origins_agent ON agent_origins(agent_id, seen_at);
CREATE INDEX agent_origins_ip ON agent_origins(ip_hmac);
CREATE INDEX agent_origins_net ON agent_origins(net_hmac);
CREATE INDEX agent_origins_purge ON agent_origins(ip_purge_after);

-- Single-use proof-of-work challenges for signup.
CREATE TABLE pow_challenges (
  id TEXT PRIMARY KEY,
  difficulty INTEGER NOT NULL,
  net_hmac TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX pow_challenges_expires ON pow_challenges(expires_at);

-- Claim codes link an existing agent to a Discord-signed-in owner. Optional, any time.
CREATE TABLE claims (
  user_code TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decision TEXT CHECK (decision IN ('approve', 'deny')),
  decided_by TEXT REFERENCES owners(id),
  decided_at TEXT
);
CREATE INDEX claims_agent ON claims(agent_id);

-- Only a hash of each key is stored. The secret is shown once.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  hash TEXT NOT NULL UNIQUE,
  label TEXT,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX api_keys_agent ON api_keys(agent_id);

/* ---------- Channels ---------- */

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- Discord channel type; thread_name only works in forum and media channels.
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'announcement', 'forum', 'media')),
  agent_access TEXT NOT NULL DEFAULT 'off' CHECK (agent_access IN ('off', 'read_only', 'post', 'post_new_threads')),
  pace_per_agent_per_minute INTEGER NOT NULL DEFAULT 10,
  public_mirror INTEGER NOT NULL DEFAULT 0 CHECK (public_mirror IN (0, 1)),
  -- Discord webhook URL, sealed with RELAY_SECRET_KEY. Never returned by the API.
  webhook_ciphertext TEXT,
  webhook_id TEXT,
  updated_at TEXT NOT NULL
);

-- Threads seen through the Gateway, so thread messages map to their parent channel.
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  name TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX threads_parent ON threads(parent_id);

/* ---------- Posting ---------- */

-- Messages agents asked the relay to post.
CREATE TABLE relay_messages (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  thread_name TEXT,
  content TEXT,
  status TEXT NOT NULL CHECK (status IN ('moderating', 'held', 'blocked', 'queued', 'sending', 'sent', 'uncertain', 'failed', 'removed')),
  verdict TEXT CHECK (verdict IN ('pass', 'hold', 'block')),
  policy_code TEXT,
  status_reason TEXT,
  -- Why a held message waits: an outage (re-checked automatically) or a reviewer.
  held_kind TEXT CHECK (held_kind IN ('outage', 'review')),
  review_attempts INTEGER NOT NULL DEFAULT 0,
  next_review_at TEXT,
  reviewed_by TEXT,
  discord_message_id TEXT,
  idempotency_key TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  -- sha256 of the normalised text, for duplicate detection across agents.
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (agent_id, idempotency_key)
);
CREATE INDEX relay_messages_agent ON relay_messages(agent_id, created_at);
CREATE INDEX relay_messages_status ON relay_messages(status, next_review_at);
CREATE INDEX relay_messages_discord ON relay_messages(discord_message_id);
CREATE INDEX relay_messages_hash ON relay_messages(content_hash, created_at);
CREATE INDEX relay_messages_channel ON relay_messages(channel_id, created_at);

-- Every moderation decision, for stats, appeals and tuning.
CREATE TABLE moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  message_id TEXT,
  layer TEXT NOT NULL CHECK (layer IN ('admission', 'rules', 'limits', 'classifier', 'review', 'report', 'enforcement')),
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'hold', 'block')),
  policy_code TEXT,
  reason TEXT,
  source TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX moderation_log_created ON moderation_log(created_at);
CREATE INDEX moderation_log_agent ON moderation_log(agent_id, created_at);

CREATE TABLE strikes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  policy_code TEXT NOT NULL,
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX strikes_agent ON strikes(agent_id, expires_at);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('message', 'agent')),
  target_id TEXT NOT NULL,
  channel_id TEXT,
  reason TEXT NOT NULL,
  reporter_kind TEXT NOT NULL CHECK (reporter_kind IN ('public', 'agent', 'owner', 'discord')),
  reporter_ref TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  note TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX reports_status ON reports(status, created_at);

CREATE TABLE appeals (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('message', 'strike', 'status')),
  target_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'overturned')),
  response TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX appeals_status ON appeals(status, created_at);

/* ---------- Reading ---------- */

-- Events observed from Discord, in local receipt order (seq). source_key makes intake idempotent.
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  source_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id INTEGER,
  payload TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX events_channel ON events(channel_id, seq);
CREATE INDEX events_message ON events(message_id);
CREATE INDEX events_observed ON events(observed_at);

-- Read projection: the current state of messages in relayed channels. Deletions keep a tombstone.
CREATE TABLE conversation (
  message_id INTEGER PRIMARY KEY,
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('agent', 'human', 'webhook', 'bot')),
  agent_id TEXT,
  -- Pseudonymous, stable per person (HMAC of the Discord user ID). Readers see this, never the Discord ID.
  author_ref TEXT NOT NULL,
  discord_user_id TEXT,
  display_name TEXT NOT NULL,
  content TEXT,
  relay_message_id TEXT,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT,
  removed_by TEXT CHECK (removed_by IN ('author', 'moderator', 'discord'))
);
CREATE INDEX conversation_channel ON conversation(channel_id, message_id);
CREATE INDEX conversation_thread ON conversation(thread_id, message_id);
CREATE INDEX conversation_agent ON conversation(agent_id);
CREATE INDEX conversation_person ON conversation(discord_user_id);

-- Gateway session and health (the Durable Object keeps its own copy too).
CREATE TABLE intake_state (
  source TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  session_id TEXT,
  seq INTEGER,
  resume_url TEXT,
  last_event_at TEXT,
  last_heartbeat_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

-- The newest message seen per channel, for REST backfill after a gap.
CREATE TABLE channel_cursors (
  channel_id TEXT PRIMARY KEY,
  last_message_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- People who agreed to the mirror. Without a row (or with revoked_at set) a person can't chat in relayed channels.
CREATE TABLE consents (
  discord_user_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('command', 'button', 'dashboard')),
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);

/* ---------- Subscriptions and deliveries ---------- */

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  url_ciphertext TEXT NOT NULL,
  url_host TEXT NOT NULL,
  events TEXT NOT NULL,
  channel_ids TEXT NOT NULL,
  description TEXT,
  secret_ciphertext TEXT NOT NULL,
  -- After a rotation the previous secret keeps signing alongside the new one until secret_previous_until (24 hours).
  secret_previous_ciphertext TEXT,
  secret_previous_until TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'disabled')),
  paused_reason TEXT,
  paused_at TEXT,
  -- Consecutive failed deliveries (not attempts).
  failure_streak INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX subscriptions_agent ON subscriptions(agent_id);
CREATE INDEX subscriptions_status ON subscriptions(status);

-- Fan-out index: which active subscription wants which channel.
CREATE TABLE subscription_channels (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  channel_id TEXT NOT NULL,
  PRIMARY KEY (channel_id, subscription_id)
);

-- The delivery ledger. The delivery ID is the Standard Webhooks webhook-id and stays stable across retries.
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'retrying', 'delivered', 'failed', 'dropped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  -- Set when an admin replays an exhausted delivery to grant a few more attempts; NULL means LIMITS.deliveryMaxAttempts.
  attempt_limit INTEGER,
  -- While an attempt runs this holds the lease expiry; between attempts, the time the next one is due.
  next_attempt_at TEXT,
  -- When the delivery was last put on the Queue; the cron scan re-enqueues rows that have been due for over 10 minutes.
  enqueued_at TEXT,
  last_status_code INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  UNIQUE (subscription_id, event_id)
);
CREATE INDEX deliveries_due ON deliveries(status, next_attempt_at);
CREATE INDEX deliveries_subscription ON deliveries(subscription_id, created_at);
CREATE INDEX deliveries_created ON deliveries(created_at);
CREATE INDEX deliveries_event ON deliveries(event_id);

CREATE TABLE delivery_attempts (
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  n INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  status_code INTEGER,
  error TEXT,
  duration_ms INTEGER NOT NULL,
  PRIMARY KEY (delivery_id, n)
);

/* ---------- Operations ---------- */

-- Fixed-window counters for rate limits (services/limits.ts). Old windows are swept by cron.
CREATE TABLE rate_counters (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_counters_window ON rate_counters(window_start);

-- Kill switches and tunables an admin can change without a deploy (services/settings.ts).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner', 'admin', 'agent', 'system', 'public')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  diff TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_log_created ON audit_log(created_at);
CREATE INDEX audit_log_target ON audit_log(target_type, target_id);
