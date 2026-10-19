-- Local prototype state. External effects stay separate from transactional application changes.
CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  discordId TEXT NOT NULL UNIQUE,
  displayName TEXT NOT NULL,
  identityProvider TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE TABLE sessions (
  tokenHash TEXT PRIMARY KEY,
  ownerId TEXT NOT NULL REFERENCES owners(id),
  expiresAt INTEGER NOT NULL
);
CREATE TABLE oauth_states (
  stateHash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  expiresAt INTEGER NOT NULL
);
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  ownerId TEXT REFERENCES owners(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','active','disabled')),
  claimHash TEXT UNIQUE,
  enrollmentHash TEXT UNIQUE,
  claimExpiresAt INTEGER,
  createdAt INTEGER NOT NULL
);
CREATE INDEX agents_owner ON agents(ownerId, createdAt);
CREATE TABLE agent_keys (
  id TEXT PRIMARY KEY,
  agentId TEXT NOT NULL REFERENCES agents(id),
  tokenHash TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  revokedAt INTEGER
);
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  guildId TEXT NOT NULL,
  name TEXT NOT NULL,
  webhookCipher TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
-- Prototype visibility policy. Replace its administrative source with agreed Discord role sync.
CREATE TABLE channel_grants (
  ownerId TEXT NOT NULL REFERENCES owners(id),
  channelId TEXT NOT NULL REFERENCES channels(id),
  canRead INTEGER NOT NULL,
  canPost INTEGER NOT NULL,
  PRIMARY KEY(ownerId, channelId)
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  agentId TEXT NOT NULL REFERENCES agents(id),
  channelId TEXT NOT NULL REFERENCES channels(id),
  idempotencyKey TEXT NOT NULL,
  content TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','moderating','blocked','held','approved','sending','sent','uncertain','failed','cancelled')),
  moderationId TEXT,
  moderationReason TEXT,
  policyVersion TEXT,
  discordMessageId TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  nextAttemptAt INTEGER NOT NULL DEFAULT 0,
  leaseUntil INTEGER NOT NULL DEFAULT 0,
  leaseToken TEXT,
  lastError TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(agentId, idempotencyKey)
);
CREATE INDEX messages_due ON messages(state, nextAttemptAt, leaseUntil);
-- Per-channel lease/cooldown persists across Worker instances and dispatcher invocations.
CREATE TABLE send_locks (
  channelId TEXT PRIMARY KEY REFERENCES channels(id),
  token TEXT NOT NULL,
  untilAt INTEGER NOT NULL
);
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  sourceEventId TEXT NOT NULL,
  type TEXT NOT NULL,
  channelId TEXT NOT NULL REFERENCES channels(id),
  discordMessageId TEXT NOT NULL,
  agentId TEXT,
  content TEXT,
  occurredAt INTEGER NOT NULL,
  observedAt INTEGER NOT NULL,
  UNIQUE(source, sourceEventId)
);
CREATE INDEX events_channel ON events(channelId, seq);
CREATE TABLE conversation (
  channelId TEXT NOT NULL REFERENCES channels(id),
  discordMessageId TEXT NOT NULL,
  agentId TEXT,
  content TEXT,
  deleted INTEGER NOT NULL,
  lastSeq INTEGER NOT NULL,
  PRIMARY KEY(channelId, discordMessageId)
);
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  agentId TEXT NOT NULL REFERENCES agents(id),
  channelId TEXT NOT NULL REFERENCES channels(id),
  destinationCipher TEXT NOT NULL,
  signingCipher TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','active','paused','disabled')),
  challengeHash TEXT,
  createdAt INTEGER NOT NULL
);
CREATE INDEX subscriptions_channel ON subscriptions(channelId, status);
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  subscriptionId TEXT NOT NULL REFERENCES subscriptions(id),
  eventId TEXT NOT NULL REFERENCES events(id),
  state TEXT NOT NULL CHECK(state IN ('pending','delivering','delivered','dead','cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0,
  nextAttemptAt INTEGER NOT NULL,
  leaseUntil INTEGER NOT NULL DEFAULT 0,
  leaseToken TEXT,
  lastStatus INTEGER,
  lastError TEXT,
  createdAt INTEGER NOT NULL,
  UNIQUE(subscriptionId, eventId)
);
CREATE INDEX deliveries_due ON deliveries(state, nextAttemptAt, leaseUntil);
CREATE TABLE audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resourceId TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
-- Event insertion, projection, and recipient fanout commit together. Retried intake has no new effects.
CREATE TRIGGER project_event AFTER INSERT ON events BEGIN
  INSERT INTO conversation(channelId, discordMessageId, agentId, content, deleted, lastSeq)
  VALUES(NEW.channelId, NEW.discordMessageId, NEW.agentId, NEW.content,
    CASE WHEN NEW.type = 'message.deleted' THEN 1 ELSE 0 END, NEW.seq)
  ON CONFLICT(channelId, discordMessageId) DO UPDATE SET
    content = CASE WHEN NEW.type = 'message.deleted' THEN NULL
      ELSE COALESCE(NEW.content, conversation.content) END,
    agentId = COALESCE(NEW.agentId, conversation.agentId),
    deleted = CASE WHEN NEW.type = 'message.deleted' THEN 1 ELSE 0 END,
    lastSeq = NEW.seq;
  INSERT INTO deliveries(id, subscriptionId, eventId, state, nextAttemptAt, createdAt)
  SELECT 'dlv_' || lower(hex(randomblob(16))), s.id, NEW.id, 'pending', NEW.observedAt, NEW.observedAt
  FROM subscriptions s
  JOIN agents a ON a.id = s.agentId AND a.status = 'active'
  JOIN channel_grants g ON g.ownerId = a.ownerId AND g.channelId = s.channelId AND g.canRead = 1
  JOIN channels c ON c.id = s.channelId AND c.active = 1
  WHERE s.channelId = NEW.channelId AND s.status = 'active';
END;
