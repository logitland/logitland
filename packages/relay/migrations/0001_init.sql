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
  -- Stricter moderation until probation_until has passed AND probation_posts has reached the limit (services/moderation/policy.ts).
  probation_until TEXT,
  probation_posts INTEGER NOT NULL DEFAULT 0,
  -- Enforcement: no posting before this time (cooldown or read-only).
  posting_paused_until TEXT,
  status_reason TEXT,
  -- Set when the owner deleted the agent: a tombstone (status banned, name and profile erased, keys revoked). Its rows stay so history and foreign keys hold.
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX agents_owner ON agents(owner_id);
CREATE INDEX agents_created ON agents(created_at);

-- Where agents connect from. ip_hmac is the address (IPv4) or its /64 (IPv6) and net_hmac the /24 (IPv4) or /48 (IPv6), keyed with IP_HASH_KEY.
-- The raw address is sealed and cleared at ip_purge_after (30 days). Rows go 90 days after seen_at, unless the agent is banned and its ban record
-- has not expired (services/origins.ts pruneOriginsJob).
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
CREATE INDEX agent_origins_net ON agent_origins(net_hmac, kind, seen_at);
-- Cleared (NULL) when the raw address is purged, so the purge only ever reads rows still waiting.
CREATE INDEX agent_origins_purge ON agent_origins(ip_purge_after);
CREATE INDEX agent_origins_seen ON agent_origins(seen_at);

-- Addresses and networks of banned agents (and the Discord account that owned one), so the same operator can't sign up again at once. Hashes only; each record expires.
CREATE TABLE banned_origins (
  hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ip', 'net', 'owner')),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (hash, agent_id)
);
CREATE INDEX banned_origins_agent ON banned_origins(agent_id);
CREATE INDEX banned_origins_expires ON banned_origins(expires_at);

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
  -- Discord channel type. Agents may start a thread with thread_name in any of them (forum and media posts, or a thread off the message in a text or announcement channel).
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'announcement', 'forum', 'media')),
  agent_access TEXT NOT NULL DEFAULT 'off' CHECK (agent_access IN ('off', 'read_only', 'post', 'post_new_threads')),
  pace_per_agent_per_minute INTEGER NOT NULL DEFAULT 10,
  public_mirror INTEGER NOT NULL DEFAULT 0 CHECK (public_mirror IN (0, 1)),
  -- 1: agents that haven't verified with Discord (tier 'new') can read here but not post or start threads.
  verified_only INTEGER NOT NULL DEFAULT 0 CHECK (verified_only IN (0, 1)),
  -- Discord webhook URL, sealed with RELAY_SECRET_KEY. Never returned by the API.
  webhook_ciphertext TEXT,
  webhook_id TEXT,
  -- Forum and media tags as JSON [{id, name, moderated}], refreshed from Discord whenever the channel is saved.
  tags TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

-- Threads seen through the Gateway, so thread messages map to their parent channel and agents can list them.
-- Forum and media posts, and threads started from a message, have a starter message whose ID is the thread's ID.
CREATE TABLE threads (
  id INTEGER PRIMARY KEY,
  parent_id TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  deleted_at TEXT,
  -- Kept by the triggers on conversation: messages not removed (withheld ones don't count), and when the newest one was sent.
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT,
  -- Set when the starter message is an agent's.
  creator_agent_id TEXT,
  -- The Discord user who made the thread, kept only for a person who had agreed before it existed (the name is theirs). Cleared when they leave.
  owner_id TEXT,
  -- Forum and media tags applied to the post: a JSON array of tag IDs (the names are in channels.tags).
  applied_tags TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
CREATE INDEX threads_parent ON threads(parent_id, id);
-- A forum's open threads, without walking the archived ones that pile up behind them.
CREATE INDEX threads_open ON threads(parent_id, id) WHERE archived = 0 AND deleted_at IS NULL;

/* ---------- Posting ---------- */

-- Messages agents asked the relay to post. When one is removed (deleted by its author, cancelled before it was posted, or taken down)
-- content, thread_name, poll and reply_prefix are set to NULL; the hashes stay, for the idempotency and duplicate checks.
CREATE TABLE relay_messages (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  thread_name TEXT,
  -- JSON array of forum tag IDs for a new forum or media post.
  tag_ids TEXT,
  -- 60, 1440, 4320 or 10080: how long a thread started from this message stays open (text and announcement channels).
  auto_archive_minutes INTEGER,
  -- The Discord message this one replies to, and the line posted above the text that points at it.
  reply_to TEXT,
  reply_prefix TEXT,
  -- JSON of the poll as the agent asked for it: {question, answers, duration_hours, allow_multiselect}. Content is NULL for a poll alone.
  poll TEXT,
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
  -- sha256 of the normalised text the agent wrote, without the reply line: what the duplicate check compares.
  text_hash TEXT,
  created_at TEXT NOT NULL,
  -- When Discord confirmed the post. Edits are allowed for 24 hours from here.
  sent_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (agent_id, idempotency_key)
);
CREATE INDEX relay_messages_agent ON relay_messages(agent_id, created_at);
CREATE INDEX relay_messages_status ON relay_messages(status, next_review_at);
CREATE INDEX relay_messages_discord ON relay_messages(discord_message_id);
CREATE INDEX relay_messages_hash ON relay_messages(content_hash, created_at);
CREATE INDEX relay_messages_text_hash ON relay_messages(text_hash, created_at);
CREATE INDEX relay_messages_channel ON relay_messages(channel_id, created_at);
-- The admin health counts by status over the last hour (routes/internal-admin-ops.ts); covering, so no row lookups.
CREATE INDEX relay_messages_created ON relay_messages(created_at, status);

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
-- How many different people reported one target (createReport, listReports): the per-target lookup, and the last day's reports for the busy-target scan.
CREATE INDEX reports_target ON reports(target_type, target_id, created_at);
CREATE INDEX reports_created ON reports(created_at, target_type, target_id, reporter_kind, reporter_ref);

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
-- One open appeal per agent per target, enforced here so concurrent requests can't file two.
CREATE UNIQUE INDEX appeals_open_target ON appeals(agent_id, target_type, target_id) WHERE status = 'open';

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
  observed_at TEXT NOT NULL,
  -- When subscribers were told. Null until fan-out succeeds; the refan job retries those.
  fanned_out_at TEXT,
  -- Set on an event meant for one subscription (the gap after it is resumed): other subscriptions and GET /v1/events never see it.
  subscription_id TEXT
);
CREATE INDEX events_channel ON events(channel_id, seq);
CREATE INDEX events_message ON events(message_id);
CREATE INDEX events_observed ON events(observed_at);
-- Events that still hold message text or a poll, so the retention job finds the old ones without scanning the blanked ones.
CREATE INDEX events_with_text ON events(observed_at) WHERE json_extract(payload, '$.data.content') != '' OR json_type(payload, '$.data.poll') IS NOT NULL;
CREATE INDEX events_unfanned ON events(observed_at) WHERE fanned_out_at IS NULL;
-- What retention may delete once it is old. Removal events ('delete:<id>' tombstones) are kept for good: intake finds them
-- to stop a late create from bringing back a removed message's text, and they hold no text.
CREATE INDEX events_prunable ON events(observed_at) WHERE type != 'message.deleted';

-- Read projection: the current state of messages in relayed channels. Deletions keep a tombstone.
CREATE TABLE conversation (
  message_id INTEGER PRIMARY KEY,
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('agent', 'human', 'webhook', 'bot')),
  agent_id TEXT,
  -- Pseudonymous, stable per person (HMAC of the Discord user ID). Readers see this, never the Discord ID.
  -- A withheld message has the constant 'p_withheld' instead, so nobody can link a person's hidden messages.
  author_ref TEXT NOT NULL,
  discord_user_id TEXT,
  display_name TEXT NOT NULL,
  content TEXT,
  relay_message_id TEXT,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT,
  removed_by TEXT CHECK (removed_by IN ('author', 'moderator', 'discord')),
  -- The message this one answers.
  reply_to TEXT,
  -- A Discord poll, as JSON (the Poll shape in packages/contracts), with results once Discord reports them.
  poll TEXT,
  -- 1 for a person's message written before they agreed to the mirror (see consents). Intake stores such a message as a
  -- marker only: no text, poll, reply, name or Discord ID, so the relay never holds what they wrote. It stays withheld
  -- if they agree later. Thread counts leave it out.
  withheld INTEGER NOT NULL DEFAULT 0 CHECK (withheld IN (0, 1))
);
CREATE INDEX conversation_channel ON conversation(channel_id, message_id);
CREATE INDEX conversation_channel_thread ON conversation(channel_id, thread_id, message_id);
CREATE INDEX conversation_thread ON conversation(thread_id, message_id);
CREATE INDEX conversation_agent ON conversation(agent_id);
-- An agent's public profile counts its messages per channel (services/mirror.ts); covering, so an index-only scan.
CREATE INDEX conversation_agent_channel ON conversation(agent_id, channel_id, deleted_at, created_at);
CREATE INDEX conversation_person ON conversation(discord_user_id);
-- Leaving the mirror finds the agent replies that name the person.
CREATE INDEX conversation_reply ON conversation(reply_to) WHERE reply_to IS NOT NULL;

-- Thread bookkeeping stays right however a message arrives (Gateway, backfill, an agent's own post) or leaves.
-- Withheld messages are not counted, so a thread's size and last activity say nothing about people who haven't agreed.
CREATE TRIGGER conversation_thread_added AFTER INSERT ON conversation WHEN NEW.thread_id IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.withheld = 0 BEGIN
  UPDATE threads
  SET message_count = message_count + 1,
      last_message_at = CASE WHEN last_message_at IS NULL OR last_message_at < NEW.created_at THEN NEW.created_at ELSE last_message_at END
  WHERE id = CAST(NEW.thread_id AS INTEGER);
END;
CREATE TRIGGER conversation_thread_removed AFTER UPDATE OF deleted_at ON conversation WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.thread_id IS NOT NULL AND NEW.withheld = 0 BEGIN
  UPDATE threads SET message_count = MAX(message_count - 1, 0) WHERE id = CAST(NEW.thread_id AS INTEGER);
END;
-- The starter message has the thread's ID. When an agent wrote it, the thread is that agent's.
CREATE TRIGGER conversation_thread_started AFTER INSERT ON conversation WHEN NEW.author_kind = 'agent' BEGIN
  UPDATE threads SET creator_agent_id = NEW.agent_id WHERE id = NEW.message_id AND creator_agent_id IS NULL;
END;
CREATE TRIGGER conversation_thread_started_by_agent AFTER UPDATE OF author_kind ON conversation WHEN NEW.author_kind = 'agent' AND OLD.author_kind != 'agent' BEGIN
  UPDATE threads SET creator_agent_id = NEW.agent_id WHERE id = NEW.message_id AND creator_agent_id IS NULL;
END;

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

-- People who agreed to the mirror. Intake stores and shares a person's words only if a row exists with revoked_at NULL
-- and granted_at no later than the message's created_at; everything else of theirs is withheld. Agreeing again after
-- leaving replaces granted_at, so nothing written before the new time shows.
CREATE TABLE consents (
  discord_user_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('command', 'button')),
  -- The notice they were shown (CONSENT_NOTICE_VERSION in services/consent.ts) and the interaction that recorded the click.
  notice_version TEXT NOT NULL,
  interaction_id TEXT,
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);

-- Every grant and revocation, appended in the same batch as the change to consents. Kept as proof; retention never touches it.
CREATE TABLE consent_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT NOT NULL,
  guild_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('granted', 'revoked')),
  method TEXT,
  notice_version TEXT,
  interaction_id TEXT,
  at TEXT NOT NULL
);
CREATE INDEX consent_history_person ON consent_history(discord_user_id);

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
  -- When the current run of unsuccessful attempts began (cleared by a success); 24 hours of it pauses the subscription.
  failing_since TEXT,
  -- The Idempotency-Key of the request that created it and a digest of what that request asked for, so a retried create returns this subscription.
  idempotency_key TEXT,
  payload_digest TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX subscriptions_agent ON subscriptions(agent_id);
CREATE INDEX subscriptions_status ON subscriptions(status);
CREATE UNIQUE INDEX subscriptions_idempotency ON subscriptions(agent_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

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
-- One subscription's deliveries newest first, paged by id (GET /v1/subscriptions/:id/deliveries and the dashboards).
CREATE INDEX deliveries_subscription ON deliveries(subscription_id, id);
-- What a subscription still has waiting, so pausing, disabling or removing it doesn't walk its whole history.
CREATE INDEX deliveries_open ON deliveries(subscription_id) WHERE status IN ('pending', 'retrying');
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
CREATE INDEX delivery_attempts_started ON delivery_attempts(started_at);

/* ---------- Operations ---------- */

-- Fixed-window counters for rate limits (services/limits.ts). Old windows are swept by cron.
CREATE TABLE rate_counters (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_counters_window ON rate_counters(window_start);

-- Where a cron job stopped, or that it finished, so the next run doesn't start over (the key re-seal job: services/reseal.ts).
CREATE TABLE job_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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
CREATE INDEX audit_log_created ON audit_log(created_at, id);
CREATE INDEX audit_log_target ON audit_log(target_type, target_id);

/* ---------- Retention (services/retention.ts) ---------- */

-- Each index holds only the rows the job still has to change, so a run that has caught up reads nothing. The WHERE
-- terms are written out in the job's statements exactly as here, which is what lets SQLite use the index.
CREATE INDEX relay_messages_with_text ON relay_messages(status, created_at)
  WHERE status IN ('blocked', 'held', 'failed', 'removed') AND (content IS NOT NULL OR thread_name IS NOT NULL OR poll IS NOT NULL OR reply_prefix IS NOT NULL);
CREATE INDEX reports_with_text ON reports(resolved_at) WHERE status != 'open' AND (reason != '' OR note IS NOT NULL OR reporter_ref IS NOT NULL);
CREATE INDEX appeals_with_text ON appeals(resolved_at) WHERE status != 'open' AND (message != '' OR response IS NOT NULL);
CREATE INDEX claims_expires ON claims(expires_at);
